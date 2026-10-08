"""Deterministic exploratory PPG features, not certified clinical fiducials.

Only NumPy/SciPy are required. Missing landmarks produce NaN features: they
never remove a recording from one filter arm. All filters start afresh for each
30-second recording. These functions do not implement continuous acquisition.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, find_peaks, sosfilt, sosfilt_zi, sosfiltfilt, welch

SAMPLE_RATE = 125
RECORD_SAMPLES = 3750
ARMS = ("raw", "legacy_kalman", "bandpass_causal", "bandpass_offline")
FEATURE_SCHEMA_VERSION = 1

_GENERAL = {
    "mean": "Arithmetic mean of filtered samples; original sensor units.",
    "std": "Population standard deviation of filtered samples.",
    "median": "Median filtered sample.",
    "minimum": "Minimum filtered sample.",
    "maximum": "Maximum filtered sample.",
    "p05": "5th percentile of filtered samples.",
    "p25": "25th percentile of filtered samples.",
    "p75": "75th percentile of filtered samples.",
    "p95": "95th percentile of filtered samples.",
    "iqr": "75th minus 25th percentile of filtered samples.",
    "rms": "Root mean square of filtered samples.",
    "skewness": "Third standardized central moment; NaN for a flat signal.",
    "excess_kurtosis": "Fourth standardized central moment minus 3; NaN if flat.",
    "mean_abs_derivative": "Mean absolute first difference times sample rate.",
    "std_derivative": "Population SD of first difference times sample rate.",
    "mean_abs_second_derivative": "Mean absolute second difference times sample rate squared.",
    "linear_trend_per_second": "Least-squares sample-amplitude slope versus elapsed seconds.",
    "dominant_frequency_hz": "Welch peak frequency within 0.5 to 8 Hz; NaN if no power.",
    "relative_power_0p5_2hz": "Welch power bins in [0.5,2) divided by power in [0.5,8].",
    "relative_power_2_4hz": "Welch power bins in [2,4) divided by power in [0.5,8].",
    "relative_power_4_8hz": "Welch power bins in [4,8] divided by power in [0.5,8].",
    "peak_count": "Exploratory maxima count, distance >=0.25 s, prominence >=0.1 IQR.",
    "usable_pulse_count": "Count of complete minima-to-minima intervals with a positive baseline-corrected peak.",
}
_PULSE = {
    "period_seconds": "Time from one minimum between adjacent maxima to the next minimum.",
    "rise_seconds": "Time from the preceding minimum proxy to the included maximum.",
    "fall_seconds": "Time from the included maximum to the following minimum proxy.",
    "rise_fraction": "Rise time divided by minima-to-minima period.",
    "amplitude": "Maximum minus the straight line joining its neighboring minima.",
    "width25_seconds": "Contiguous pulse width at 25% of baseline-corrected peak; linearly interpolated.",
    "width50_seconds": "Contiguous pulse width at 50% of baseline-corrected peak; linearly interpolated.",
    "width75_seconds": "Contiguous pulse width at 75% of baseline-corrected peak; linearly interpolated.",
    "normalized_area_seconds": "Trapezoidal integral of baseline-corrected pulse divided by its peak amplitude.",
    "maximum_normalized_rise_slope": "Largest first-difference slope before maximum, divided by pulse amplitude.",
    "maximum_normalized_fall_slope": "Magnitude of most negative first-difference slope after maximum, divided by amplitude.",
}
FEATURE_DEFINITIONS = dict(_GENERAL)
for _name, _description in _PULSE.items():
    FEATURE_DEFINITIONS[f"pulse_{_name}_median"] = "Median across complete pulses. " + _description
    FEATURE_DEFINITIONS[f"pulse_{_name}_iqr"] = "75th minus 25th percentile across complete pulses. " + _description
FEATURE_NAMES = tuple(FEATURE_DEFINITIONS)


def feature_contract():
    return {
        "schema_version": FEATURE_SCHEMA_VERSION,
        "contract": "exploratory_recording_features_v1",
        "feature_names": list(FEATURE_NAMES),
        "features": [
            {"index": index, "name": name, "definition": FEATURE_DEFINITIONS[name]}
            for index, name in enumerate(FEATURE_NAMES)
        ],
        "missing_value": "NaN; imputation statistics must be fitted on training data only",
        "landmark_status": "Derived extrema proxies; not clinically validated feet, systolic peaks or PTT",
        "ppg_polarity": "Assumes positive-going pulses; polarity is not inferred from labels",
        "peak_detector": {"minimum_distance_samples": 31, "prominence_iqr_fraction": 0.1},
    }


def legacy_kalman_records(records):
    """Original scalar recurrence, vectorized across independent recordings."""
    records = np.asarray(records, dtype=np.float64)
    if records.ndim != 2:
        raise ValueError("Expected (recordings, samples).")
    result = np.empty_like(records)
    state = np.zeros(records.shape[0], dtype=np.float64)
    covariance = np.ones_like(state)
    process = np.full_like(state, 1e-5)
    measurement = np.full_like(state, 1e-2)
    for index in range(records.shape[1]):
        prior = state
        prior_covariance = covariance + process
        gain = prior_covariance / (prior_covariance + measurement)
        state = prior + gain * (records[:, index] - prior)
        covariance = (1 - gain) * prior_covariance
        result[:, index] = state
        residual = records[:, index] - prior
        process = 0.99 * process + 0.01 * residual**2
        measurement = 0.99 * measurement + 0.01 * residual**2
    return result


def filter_records(records):
    """Return all four matched-filter arms using no labels or learned statistics."""
    records = np.asarray(records, dtype=np.float64)
    if records.ndim != 2 or records.shape[1] != RECORD_SAMPLES or not np.isfinite(records).all():
        raise ValueError("Expected finite (N,3750) PPG recordings.")
    sos = butter(2, [0.5, 8.0], btype="bandpass", fs=SAMPLE_RATE, output="sos")
    initial = sosfilt_zi(sos)[:, None, :] * records[None, :, 0, None]
    causal, _ = sosfilt(sos, records, axis=-1, zi=initial)
    result = {
        "raw": records.copy(),
        "legacy_kalman": legacy_kalman_records(records),
        "bandpass_causal": causal,
        "bandpass_offline": sosfiltfilt(sos, records, axis=-1),
    }
    for name, array in result.items():
        if not np.isfinite(array).all() or np.any(np.abs(array) > np.finfo(np.float32).max):
            raise ValueError(f"Filter {name} produced non-finite or non-float32 output.")
        result[name] = array.astype(np.float32)
    return result


def _width(pulse, peak_index, level):
    """Crossings immediately surrounding the maximum, in sample units."""
    left = peak_index
    while left > 0 and pulse[left] >= level:
        left -= 1
    right = peak_index
    while right < len(pulse) - 1 and pulse[right] >= level:
        right += 1
    if pulse[left] >= level or pulse[right] >= level:
        return np.nan
    left_position = left + (level - pulse[left]) / (pulse[left + 1] - pulse[left])
    right_position = right - 1 + (level - pulse[right - 1]) / (pulse[right] - pulse[right - 1])
    return (right_position - left_position) / SAMPLE_RATE


def extract_features(recording):
    signal = np.asarray(recording, dtype=np.float64)
    if signal.shape != (RECORD_SAMPLES,) or not np.isfinite(signal).all():
        raise ValueError("Expected a finite 3750-sample recording.")
    q05, q25, median, q75, q95 = np.percentile(signal, [5, 25, 50, 75, 95])
    mean = float(np.mean(signal))
    centered = signal - mean
    std = float(np.std(signal))
    iqr = float(q75 - q25)
    flat = std <= np.finfo(float).eps * max(1.0, float(np.max(np.abs(signal))))
    standardized = centered / std if not flat else None
    derivative = np.diff(signal) * SAMPLE_RATE
    time = np.arange(len(signal), dtype=np.float64) / SAMPLE_RATE
    time -= time.mean()
    frequency, power = welch(signal, fs=SAMPLE_RATE, nperseg=512, noverlap=256, detrend="constant")
    passband = (frequency >= 0.5) & (frequency <= 8)
    total_power = float(np.sum(power[passband]))
    values = {
        "mean": mean, "std": std, "median": median, "minimum": signal.min(),
        "maximum": signal.max(), "p05": q05, "p25": q25, "p75": q75,
        "p95": q95, "iqr": iqr, "rms": np.sqrt(np.mean(signal**2)),
        "skewness": np.mean(standardized**3) if not flat else np.nan,
        "excess_kurtosis": np.mean(standardized**4) - 3 if not flat else np.nan,
        "mean_abs_derivative": np.mean(np.abs(derivative)),
        "std_derivative": np.std(derivative),
        "mean_abs_second_derivative": np.mean(np.abs(np.diff(derivative) * SAMPLE_RATE)),
        "linear_trend_per_second": np.dot(time, centered) / np.dot(time, time),
        "dominant_frequency_hz": frequency[passband][np.argmax(power[passband])] if total_power > 0 else np.nan,
    }
    for name, selection in (
        ("relative_power_0p5_2hz", (frequency >= 0.5) & (frequency < 2)),
        ("relative_power_2_4hz", (frequency >= 2) & (frequency < 4)),
        ("relative_power_4_8hz", (frequency >= 4) & (frequency <= 8)),
    ):
        values[name] = float(np.sum(power[selection])) / total_power if total_power > 0 else np.nan
    peaks = np.empty(0, dtype=int) if flat else find_peaks(
        signal, distance=max(1, int(0.25 * SAMPLE_RATE)), prominence=max(0.1 * iqr, np.finfo(float).eps)
    )[0]
    # Every proxy foot is an interior minimum between neighboring maxima.
    minima = [int(left + np.argmin(signal[left:right + 1])) for left, right in zip(peaks[:-1], peaks[1:])]
    measurements = {name: [] for name in _PULSE}
    for index in range(1, len(peaks) - 1):
        left, peak, right = minima[index - 1], int(peaks[index]), minima[index]
        if not left < peak < right:
            continue
        pulse = signal[left:right + 1]
        corrected = pulse - np.linspace(pulse[0], pulse[-1], len(pulse))
        peak_index = peak - left
        amplitude = float(corrected[peak_index])
        if amplitude <= np.finfo(float).eps * max(1.0, float(np.max(np.abs(pulse)))):
            continue
        normalized = corrected / amplitude
        period = (right - left) / SAMPLE_RATE
        rise = (peak - left) / SAMPLE_RATE
        measurements["period_seconds"].append(period)
        measurements["rise_seconds"].append(rise)
        measurements["fall_seconds"].append((right - peak) / SAMPLE_RATE)
        measurements["rise_fraction"].append(rise / period)
        measurements["amplitude"].append(amplitude)
        for fraction in (25, 50, 75):
            measurements[f"width{fraction}_seconds"].append(_width(normalized, peak_index, fraction / 100))
        measurements["normalized_area_seconds"].append(float(np.sum((normalized[1:] + normalized[:-1]) * 0.5) / SAMPLE_RATE))
        measurements["maximum_normalized_rise_slope"].append(float(np.max(np.diff(normalized[:peak_index + 1])) * SAMPLE_RATE))
        measurements["maximum_normalized_fall_slope"].append(float(-np.min(np.diff(normalized[peak_index:])) * SAMPLE_RATE))
    values["peak_count"] = len(peaks)
    values["usable_pulse_count"] = len(measurements["period_seconds"])
    for name, samples in measurements.items():
        samples = np.asarray(samples, dtype=float)
        samples = samples[np.isfinite(samples)]
        if len(samples):
            q1, q2, q3 = np.percentile(samples, [25, 50, 75])
            values[f"pulse_{name}_median"] = q2
            values[f"pulse_{name}_iqr"] = q3 - q1
        else:
            values[f"pulse_{name}_median"] = np.nan
            values[f"pulse_{name}_iqr"] = np.nan
    result = np.asarray([values[name] for name in FEATURE_NAMES], dtype=np.float64)
    if np.isinf(result).any() or np.any(np.abs(result[np.isfinite(result)]) > np.finfo(np.float32).max):
        raise ValueError("Feature numeric overflow; input needs investigation.")
    return result.astype(np.float32)
