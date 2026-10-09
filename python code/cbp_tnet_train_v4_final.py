# =====================================
# cbp_tnet_train_v4_final.py
# cBP-Tnet v4 — Final Recommended Script
# =====================================
#
# This is the production version of cBP-Tnet.
#
# What changed from the original v4 (job 27694515):
#   - Per-subject calibration added at inference (Section 4 of report)
#     Reduces test SBP MAE 14.3 → 10.2, DBP 9.6 → 5.9
#     No architecture change — purely inference-time offset correction
#   - Calibration eval reports held-out MAE (cal windows excluded)
#     for honest comparison alongside the full-set calibrated MAE
#   - Everything else identical to job 27694515
#
# Results:
#   Uncalibrated:  SBP 14.3 mmHg  DBP 9.6 mmHg
#   Calibrated:    SBP 10.2 mmHg  DBP 5.9 mmHg  (K=5 reference windows)
#
# Usage:
#   python cbp_tnet_train_v4_final.py
#   sbatch submit_cbp_tnet.sbatch
# =====================================

import os
import sys
import numpy as np
import pandas as pd
import torch
from torch import nn, optim
import torch.utils.data as Data
from torch.utils.data import Dataset
import torch.nn.functional as F
import glob
from pyampd.ampd import find_peaks
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import time
import warnings
import random
from tqdm import tqdm
from scipy.stats import linregress
from scipy.signal import find_peaks as sp_find_peaks
import seaborn as sns

warnings.filterwarnings('ignore')

import matplotlib.font_manager as _fm
_tnr = any('Times New Roman' in f.name for f in _fm.fontManager.ttflist)
plt.rcParams['font.family'] = 'Times New Roman' if _tnr else 'DejaVu Sans'

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {DEVICE}")


def set_random_seeds(seed=125):
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# =====================================
# Module 1: Dataset Loading
# =====================================

MIMIC_BP_SAMPLE_FREQ = 125  # Hz


def find_dataset(base_dir):
    dataset_root = os.path.join(base_dir, 'mimic_bp')
    ppg_dir    = os.path.join(dataset_root, 'ppg')
    abp_dir    = os.path.join(dataset_root, 'abp')
    labels_dir = os.path.join(dataset_root, 'labels')
    train_txt  = os.path.join(dataset_root, 'train_subjects.txt')
    val_txt    = os.path.join(dataset_root, 'val_subjects.txt')
    test_txt   = os.path.join(dataset_root, 'test_subjects.txt')
    missing = [p for p in [ppg_dir, abp_dir, labels_dir, train_txt, val_txt, test_txt]
               if not os.path.exists(p)]
    if missing:
        print("ERROR: MIMIC-BP dataset not found. Missing:")
        for m in missing: print(f"  {m}")
        sys.exit(1)
    ppg_files = glob.glob(os.path.join(ppg_dir, '*.npy'))
    print(f"MIMIC-BP: {len(ppg_files)} subjects")
    if ppg_files:
        s = np.load(ppg_files[0])
        print(f"  Data shape check: {os.path.basename(ppg_files[0])} → {s.shape}  (expect (30, 3750))")
    return {'ppg_dir': ppg_dir, 'abp_dir': abp_dir, 'labels_dir': labels_dir,
            'train_txt': train_txt, 'val_txt': val_txt, 'test_txt': test_txt}


def _read_subject_list(txt_path):
    with open(txt_path, 'r') as f:
        content = f.read().strip()
    if content.startswith('['):
        import ast
        try:
            ids = ast.literal_eval(content)
            return [str(s).strip() for s in ids if str(s).strip()]
        except Exception:
            content = content.strip('[]')
            return [s.strip().strip("'").strip('"') for s in content.split(',') if s.strip()]
    return [line.strip() for line in content.splitlines() if line.strip()]


def load_dataset(dataset_paths, split='train'):
    ppg_dir    = dataset_paths['ppg_dir']
    abp_dir    = dataset_paths['abp_dir']
    labels_dir = dataset_paths['labels_dir']

    def build_map(directory, suffix):
        m = {}
        for f in glob.glob(os.path.join(directory, '*.npy')):
            base = os.path.splitext(os.path.basename(f))[0].lower()
            key  = base.replace(suffix, '').rstrip('_')
            m[key] = f
        return m

    ppg_map    = build_map(ppg_dir,    '_ppg')
    abp_map    = build_map(abp_dir,    '_abp')
    labels_map = build_map(labels_dir, '_labels')

    subject_ids = _read_subject_list(dataset_paths[f'{split}_txt'])
    print(f"  Subject list: {len(subject_ids)} IDs, sample: {subject_ids[:3]}")

    _debug_n = int(os.environ.get('DEBUG_SAMPLES', 0))
    if _debug_n > 0:
        subject_ids = subject_ids[:_debug_n]
        print(f"  DEBUG_SAMPLES={_debug_n}: using {len(subject_ids)} subjects")

    print(f"Loading MIMIC-BP (split='{split}'): {len(subject_ids)} subjects")
    PPG_list, ABP_list, SBP_list, DBP_list = [], [], [], []
    skipped = 0
    for sid in tqdm(subject_ids, desc=f"Loading ({split})"):
        if sid not in ppg_map or sid not in abp_map or sid not in labels_map:
            skipped += 1; continue
        try:
            ppg    = np.load(ppg_map[sid]).astype(np.float32)
            abp    = np.load(abp_map[sid]).astype(np.float32)
            labels = np.load(labels_map[sid]).astype(np.float32)
        except Exception:
            skipped += 1; continue
        if ppg.shape != (30, 3750) or abp.shape != (30, 3750) or labels.shape != (30, 2):
            n = min(ppg.shape[0], abp.shape[0], labels.shape[0])
            if n == 0: skipped += 1; continue
            ppg, abp, labels = ppg[:n], abp[:n], labels[:n]
        PPG_list.append(ppg)
        ABP_list.append(abp)
        SBP_list.append(labels[:, 0])
        DBP_list.append(labels[:, 1])
    if skipped:
        print(f"  Skipped {skipped} subjects")
    print(f"  Loaded: {len(PPG_list)} subjects")
    if PPG_list:
        s = np.concatenate(SBP_list); d = np.concatenate(DBP_list)
        print(f"  SBP: [{s.min():.1f}, {s.max():.1f}]  mean={s.mean():.1f}")
        print(f"  DBP: [{d.min():.1f}, {d.max():.1f}]  mean={d.mean():.1f}")
    return PPG_list, ABP_list, SBP_list, DBP_list


# =====================================
# Module 2: Signal Processing
# =====================================

def adaptive_kalman_filter(signal, initial_state=0, initial_covariance=1,
                           process_variance=1e-5, measurement_variance=1e-2):
    n = len(signal)
    filtered = np.zeros(n)
    x, P = initial_state, initial_covariance
    for t in range(n):
        x_prior = x
        P_prior = P + process_variance
        K = P_prior / (P_prior + measurement_variance)
        x = x_prior + K * (signal[t] - x_prior)
        P = (1 - K) * P_prior
        filtered[t] = x
        residual = signal[t] - x_prior
        process_variance     = 0.99 * process_variance     + 0.01 * residual**2
        measurement_variance = 0.99 * measurement_variance + 0.01 * residual**2
    return filtered


def generate_fixed_length_vector(signal, length):
    if len(signal) < length:
        out = np.zeros(length)
        out[:len(signal)] = signal
    else:
        out = signal[:length]
    return out


# =====================================
# Module 3: Feature Extraction
# =====================================

def generate_features(PPG_list, ABP_list, SBP_list, DBP_list,
                      sample_freq=125, window_size=250,
                      max_beats_per_subject=200):
    """
    Beat-segmented feature extraction with per-beat SBP/DBP from ABP waveform.
    Returns beats (N, 3, window_size), SBP (N,), DBP (N,),
            ptt_feats (N, 2), subject_ids (N,)
    """
    beats_list, sbp_out, dbp_out, ptt_out, subj_out = [], [], [], [], []

    for subj_idx in tqdm(range(len(PPG_list)), desc="Feature extraction"):
        ppg_subj = PPG_list[subj_idx]
        abp_subj = ABP_list[subj_idx]
        sbp_subj = SBP_list[subj_idx]
        dbp_subj = DBP_list[subj_idx]

        subj_beats, subj_sbp, subj_dbp, subj_ptt = [], [], [], []
        n_segs = ppg_subj.shape[0]

        for seg_idx in range(n_segs):
            ppg_seg = ppg_subj[seg_idx]
            abp_seg = abp_subj[seg_idx]
            seg_sbp = float(sbp_subj[seg_idx])
            seg_dbp = float(dbp_subj[seg_idx])

            if np.isnan(seg_sbp) or np.isnan(seg_dbp): continue
            if seg_sbp < 50 or seg_sbp > 220 or seg_dbp < 20 or seg_dbp > 150: continue

            ppg_filt = adaptive_kalman_filter(ppg_seg)
            try:
                peaks = find_peaks(ppg_filt, scale=sample_freq)
            except Exception:
                continue
            if len(peaks) < 3: continue

            for i in range(2, len(peaks)):
                beat_start = peaks[i-1]
                beat_end   = peaks[i]
                seg = ppg_filt[beat_start:beat_end]
                if len(seg) < 10: continue

                abp_beat = abp_seg[beat_start: beat_start + window_size]
                if len(abp_beat) < window_size // 2: continue

                # Per-beat SBP/DBP from ABP waveform (prominence-filtered)
                try:
                    abp_smooth = adaptive_kalman_filter(abp_beat)
                    s_peaks, s_props = sp_find_peaks(
                        abp_smooth, prominence=3.0,
                        distance=max(5, len(abp_smooth) // 4))
                    if len(s_peaks) > 0:
                        best_pk  = s_peaks[np.argmax(s_props['prominences'])]
                        beat_sbp = float(abp_smooth[best_pk])
                        search_end = int(best_pk)
                        beat_dbp = float(np.min(abp_smooth[:search_end])) \
                                   if search_end > 2 else float(np.min(abp_smooth))
                    else:
                        beat_sbp = float(np.max(abp_beat))
                        beat_dbp = float(np.min(abp_beat))
                except Exception:
                    beat_sbp = float(np.max(abp_beat))
                    beat_dbp = float(np.min(abp_beat))

                if beat_sbp < 50 or beat_sbp > 220: continue
                if beat_dbp < 20 or beat_dbp > 150: continue
                if beat_sbp - beat_dbp < 10: continue

                d1  = np.gradient(seg)
                d2  = np.gradient(d1)
                ch0 = generate_fixed_length_vector(seg, window_size)
                ch1 = generate_fixed_length_vector(d1,  window_size)
                ch2 = generate_fixed_length_vector(d2,  window_size)
                beat = np.stack([ch0, ch1, ch2], axis=0)

                # PTT-proxy scalar features
                try:
                    upstroke_time = int(np.argmax(seg)) / sample_freq
                except Exception:
                    upstroke_time = 0.0
                beat_interval = (beat_end - beat_start) / sample_freq
                ptt_feat = np.array([
                    np.clip(upstroke_time / 0.15, 0.0, 3.0),
                    np.clip(beat_interval  / 1.2,  0.0, 3.0),
                ], dtype=np.float32)

                subj_beats.append(beat)
                subj_sbp.append(beat_sbp)
                subj_dbp.append(beat_dbp)
                subj_ptt.append(ptt_feat)

        # Per-subject beat cap
        if len(subj_beats) > max_beats_per_subject:
            idx = np.random.choice(len(subj_beats), max_beats_per_subject, replace=False)
            subj_beats = [subj_beats[i] for i in idx]
            subj_sbp   = [subj_sbp[i]   for i in idx]
            subj_dbp   = [subj_dbp[i]   for i in idx]
            subj_ptt   = [subj_ptt[i]   for i in idx]

        beats_list.extend(subj_beats)
        sbp_out.extend(subj_sbp)
        dbp_out.extend(subj_dbp)
        ptt_out.extend(subj_ptt)
        subj_out.extend([subj_idx] * len(subj_beats))

    print(f"  Generated {len(beats_list)} beat segments")
    ptt_arr  = np.array(ptt_out,  dtype=np.float32) if ptt_out  else np.zeros((0, 2), dtype=np.float32)
    subj_arr = np.array(subj_out, dtype=np.int32)   if subj_out else np.zeros(0,      dtype=np.int32)
    return (np.array(beats_list, dtype=np.float32),
            np.array(sbp_out,   dtype=np.float32),
            np.array(dbp_out,   dtype=np.float32),
            ptt_arr, subj_arr)


# =====================================
# Module 4: Normalization
# =====================================

def normalize_beats(X_train, X_val, X_test,
                    PTT_train=None, PTT_val=None, PTT_test=None):
    means = X_train.mean(axis=(0, 2), keepdims=True)
    stds  = X_train.std( axis=(0, 2), keepdims=True)
    stds  = np.where(stds < 1e-8, 1.0, stds)
    X_train_n = (X_train - means) / stds
    X_val_n   = (X_val   - means) / stds
    X_test_n  = (X_test  - means) / stds

    if PTT_train is not None and len(PTT_train) > 0:
        ptt_mean = PTT_train.mean(axis=0, keepdims=True)
        ptt_std  = PTT_train.std( axis=0, keepdims=True)
        ptt_std  = np.where(ptt_std < 1e-8, 1.0, ptt_std)
        PTT_train_n = (PTT_train - ptt_mean) / ptt_std
        PTT_val_n   = (PTT_val   - ptt_mean) / ptt_std
        PTT_test_n  = (PTT_test  - ptt_mean) / ptt_std
    else:
        PTT_train_n = np.zeros((len(X_train), 2), dtype=np.float32)
        PTT_val_n   = np.zeros((len(X_val),   2), dtype=np.float32)
        PTT_test_n  = np.zeros((len(X_test),  2), dtype=np.float32)

    return X_train_n, X_val_n, X_test_n, means, stds, PTT_train_n, PTT_val_n, PTT_test_n


# =====================================
# Module 5: Augmentation & Dataset
# =====================================

def augment_beat(beat, window_size):
    ch = beat[0].copy()
    if random.random() < 0.5:
        ch += np.random.normal(0, 0.02, ch.shape)
    if random.random() < 0.5:
        ch *= (1 + np.random.uniform(-0.1, 0.1))
    if random.random() < 0.3:
        t = np.linspace(0, 2 * np.pi, len(ch))
        ch += 0.05 * np.sin(t + np.random.uniform(0, np.pi))
    if random.random() < 0.3:
        factor  = 1 + np.random.uniform(-0.1, 0.1)
        orig_len = len(ch)
        new_len  = max(10, int(orig_len * factor))
        stretched = np.interp(np.linspace(0, orig_len - 1, new_len),
                              np.arange(orig_len), ch)
        ch = generate_fixed_length_vector(stretched, orig_len)
    if random.random() < 0.2:
        mask_size = random.randint(5, 20)
        start = random.randint(0, max(0, len(ch) - mask_size - 1))
        ch[start:start + mask_size] = 0.0
    d1 = np.gradient(ch); d2 = np.gradient(d1)
    return np.stack([ch, d1, d2], axis=0).astype(np.float32)


class BloodPressureDataset(Dataset):
    def __init__(self, X, y_sbp, y_dbp, ptt=None, subject_ids=None, augment=False):
        self.X           = X.astype(np.float32)
        self.y_sbp       = y_sbp.astype(np.float32)
        self.y_dbp       = y_dbp.astype(np.float32)
        self.ptt         = ptt.astype(np.float32) if ptt is not None \
                           else np.zeros((len(X), 2), dtype=np.float32)
        self.subject_ids = subject_ids
        self.augment     = augment
        self.win         = X.shape[2]

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        beat = self.X[idx].copy()
        if self.augment:
            beat = augment_beat(beat, self.win)
        ptt = torch.from_numpy(self.ptt[idx])
        return (torch.from_numpy(beat),
                torch.tensor([self.y_sbp[idx], self.y_dbp[idx]], dtype=torch.float32),
                ptt,
                int(self.subject_ids[idx]) if self.subject_ids is not None else 0)


class SubjectStratifiedSampler(torch.utils.data.Sampler):
    def __init__(self, subject_ids, beats_per_subject=30):
        self.beats_per_subject = beats_per_subject
        subj_arr = np.asarray(subject_ids)
        self.groups = [np.where(subj_arr == s)[0] for s in np.unique(subj_arr)]

    def __iter__(self):
        selected = []
        for grp in self.groups:
            n = min(self.beats_per_subject, len(grp))
            selected.extend(np.random.choice(grp, size=n, replace=False).tolist())
        np.random.shuffle(selected)
        return iter(selected)

    def __len__(self):
        return sum(min(self.beats_per_subject, len(g)) for g in self.groups)


# =====================================
# Module 6: Model — cBP-Tnet
# =====================================

class ConvBlock(nn.Module):
    def __init__(self, in_ch, out_ch, kernel_size=7, stride=1, padding=3):
        super().__init__()
        self.conv = nn.Conv1d(in_ch, out_ch, kernel_size, stride=stride,
                              padding=padding, bias=False)
        self.bn   = nn.BatchNorm1d(out_ch)
        self.act  = nn.GELU()
        self.res  = nn.Conv1d(in_ch, out_ch, 1, stride=stride, bias=False) \
                    if (in_ch != out_ch or stride != 1) else nn.Identity()

    def forward(self, x):
        return self.act(self.bn(self.conv(x)) + self.res(x))


class CNNTransformerBP(nn.Module):
    """
    cBP-Tnet: single-beat PPG → SBP + DBP.

    Input : (B, 3, 250)  [PPG, dPPG, d²PPG]  +  (B, 2)  PTT scalars
    CNN   : 4 ConvBlocks, 2× MaxPool → (B, 256, 62)
    Transformer (pre-norm, 6 layers, 8 heads) → global avg pool → (B, 256)
    PTT embed → concat → (B, 288)
    SBP/DBP heads → scalar each
    """
    def __init__(self, in_channels=3, window_size=250, model_dim=256,
                 num_heads=8, num_layers=6, dropout=0.35, ptt_dim=32):
        super().__init__()
        self.cnn = nn.Sequential(
            ConvBlock(in_channels, 64,        kernel_size=7, padding=3),
            ConvBlock(64,          128,       kernel_size=5, padding=2),
            nn.MaxPool1d(2),
            nn.Dropout(dropout * 0.25),
            ConvBlock(128,         model_dim, kernel_size=3, padding=1),
            ConvBlock(model_dim,   model_dim, kernel_size=3, padding=1),
            nn.MaxPool1d(2),
            nn.Dropout(dropout * 0.25),
        )
        seq_len = window_size // 4
        self.pos_enc = nn.Parameter(torch.randn(1, seq_len, model_dim) * 0.02)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=model_dim, nhead=num_heads,
            dim_feedforward=model_dim * 4,
            dropout=dropout, activation='gelu',
            batch_first=True, norm_first=True)
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=num_layers)
        self.norm = nn.LayerNorm(model_dim)
        self.ptt_embed = nn.Sequential(
            nn.Linear(2, ptt_dim), nn.GELU(), nn.Linear(ptt_dim, ptt_dim))
        fused_dim = model_dim + ptt_dim
        head_dim  = fused_dim // 2
        self.sbp_head = nn.Sequential(
            nn.Linear(fused_dim, head_dim), nn.GELU(),
            nn.Dropout(dropout), nn.Linear(head_dim, 1))
        self.dbp_head = nn.Sequential(
            nn.Linear(fused_dim, head_dim), nn.GELU(),
            nn.Dropout(dropout), nn.Linear(head_dim, 1))

    def forward(self, x, ptt):
        x = self.cnn(x)
        x = x.permute(0, 2, 1)
        x = x + self.pos_enc[:, :x.size(1), :]
        x = self.transformer(x)
        x = self.norm(x).mean(dim=1)
        p = self.ptt_embed(ptt)
        x = torch.cat([x, p], dim=-1)
        sbp = self.sbp_head(x).squeeze(-1)
        dbp = self.dbp_head(x).squeeze(-1)
        return torch.stack([sbp, dbp], dim=-1)


# =====================================
# Module 7: Loss
# =====================================

class ClinicalHuberLoss(nn.Module):
    def __init__(self, delta=5.0, sbp_weight=1.2, clinical_weight=2.0):
        super().__init__()
        self.delta           = delta
        self.sbp_weight      = sbp_weight
        self.clinical_weight = clinical_weight

    def forward(self, preds, targets):
        sbp_pred = preds[:, 0];  dbp_pred = preds[:, 1]
        sbp_true = targets[:, 0]; dbp_true = targets[:, 1]
        sbp_loss = F.huber_loss(sbp_pred, sbp_true, reduction='none', delta=self.delta)
        dbp_loss = F.huber_loss(dbp_pred, dbp_true, reduction='none', delta=self.delta)
        sbp_cw = torch.where((sbp_true >= 140) | (sbp_true <= 90),
                             torch.full_like(sbp_true, self.clinical_weight),
                             torch.ones_like(sbp_true))
        dbp_cw = torch.where((dbp_true >= 90) | (dbp_true <= 60),
                             torch.full_like(dbp_true, self.clinical_weight),
                             torch.ones_like(dbp_true))
        return (sbp_loss * sbp_cw).mean() * self.sbp_weight + \
               (dbp_loss * dbp_cw).mean()


# =====================================
# Module 8: Per-Subject Calibration
# =====================================

def calibrate_predictions(sbp_pred, dbp_pred, sbp_true, dbp_true,
                          subject_ids, k_cal=5):
    """
    Per-subject affine shift calibration.

    For each subject, uses the first k_cal beats as a calibration reference
    (simulating one cuff reading per subject in deployment).
    Returns:
      sbp_cal, dbp_cal : calibrated predictions (same shape as input)
      sbp_cal_ho, dbp_cal_ho : held-out calibrated predictions
                                (cal beats excluded — honest eval metric)
    """
    sbp_cal    = sbp_pred.copy()
    dbp_cal    = dbp_pred.copy()
    sbp_cal_ho = np.full_like(sbp_pred, np.nan)
    dbp_cal_ho = np.full_like(dbp_pred, np.nan)

    for sid in np.unique(subject_ids):
        idx = np.where(subject_ids == sid)[0]
        if len(idx) <= k_cal:
            offset_sbp = np.mean(sbp_true[idx] - sbp_pred[idx])
            offset_dbp = np.mean(dbp_true[idx] - dbp_pred[idx])
            sbp_cal[idx] += offset_sbp
            dbp_cal[idx] += offset_dbp
            # Not enough beats for a held-out eval — skip
            continue

        cal_idx  = idx[:k_cal]
        eval_idx = idx[k_cal:]

        offset_sbp = np.mean(sbp_true[cal_idx] - sbp_pred[cal_idx])
        offset_dbp = np.mean(dbp_true[cal_idx] - dbp_pred[cal_idx])

        sbp_cal[cal_idx]  += offset_sbp
        dbp_cal[cal_idx]  += offset_dbp
        sbp_cal[eval_idx] += offset_sbp
        dbp_cal[eval_idx] += offset_dbp

        # Held-out: only eval_idx (cal beats not included)
        sbp_cal_ho[eval_idx] = sbp_cal[eval_idx]
        dbp_cal_ho[eval_idx] = dbp_cal[eval_idx]

    return sbp_cal, dbp_cal, sbp_cal_ho, dbp_cal_ho


# =====================================
# Module 9: Training
# =====================================

class Trainer:
    def __init__(self, model, train_loader, val_loader, epochs, lr,
                 save_path='cBP-Tnet_Model.pth', patience=80, min_delta=1e-4,
                 warmup_epochs=10):
        self.model         = model
        self.train_loader  = train_loader
        self.val_loader    = val_loader
        self.epochs        = epochs
        self.save_path     = save_path
        self.patience      = patience
        self.min_delta     = min_delta
        self.device        = DEVICE
        self.model.to(self.device)

        self.optimizer = optim.AdamW(model.parameters(), lr=lr,
                                     weight_decay=1e-3, eps=1e-8)

        def lr_lambda(epoch):
            if epoch < warmup_epochs:
                return (epoch + 1) / warmup_epochs
            progress = (epoch - warmup_epochs) / max(1, epochs - warmup_epochs)
            eta_min_ratio = 1e-6 / lr if lr > 0 else 0.0
            return eta_min_ratio + 0.5 * (1.0 - eta_min_ratio) * (1.0 + np.cos(np.pi * progress))

        self.scheduler = optim.lr_scheduler.LambdaLR(self.optimizer, lr_lambda=lr_lambda)
        self.criterion = ClinicalHuberLoss(delta=5.0)

        self.best_combined_mae = float('inf')
        self.best_val_loss     = float('inf')
        self.best_epoch        = 0
        self.best_sbp_mae      = float('inf')
        self.best_dbp_mae      = float('inf')
        self.epochs_no_improve = 0
        self.train_losses      = []
        self.val_losses        = []
        self.train_sbp_maes    = []
        self.val_sbp_maes      = []
        self.train_dbp_maes    = []
        self.val_dbp_maes      = []
        self.loss_plot_path    = None

    def _run_epoch(self, loader, train=True, grad_clip=4.0):
        self.model.train(train)
        total_loss = total_sbp = total_dbp = 0.0
        ctx = torch.enable_grad() if train else torch.no_grad()
        with ctx:
            for batch_X, batch_y, batch_ptt, _ in loader:
                batch_X   = batch_X.to(self.device)
                batch_y   = batch_y.to(self.device)
                batch_ptt = batch_ptt.to(self.device)
                if train:
                    self.optimizer.zero_grad()
                out  = self.model(batch_X, batch_ptt)
                loss = self.criterion(out, batch_y)
                if train:
                    loss.backward()
                    nn.utils.clip_grad_norm_(self.model.parameters(), grad_clip)
                    self.optimizer.step()
                total_loss += loss.item()
                with torch.no_grad():
                    total_sbp += (out[:, 0] - batch_y[:, 0]).abs().mean().item()
                    total_dbp += (out[:, 1] - batch_y[:, 1]).abs().mean().item()
        n = len(loader)
        return total_loss / n, total_sbp / n, total_dbp / n

    def _save_live_loss_plot(self):
        if not self.loss_plot_path: return
        try:
            eps = list(range(1, len(self.train_losses) + 1))
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
            ax1.plot(eps, self.train_sbp_maes, label='Train SBP', color='steelblue')
            ax1.plot(eps, self.val_sbp_maes,   label='Val SBP',   color='steelblue', linestyle='--')
            ax1.plot(eps, self.train_dbp_maes, label='Train DBP', color='coral')
            ax1.plot(eps, self.val_dbp_maes,   label='Val DBP',   color='coral',     linestyle='--')
            ax1.axhline(5,  color='green',  linestyle=':', alpha=0.6, label='5 mmHg')
            ax1.axhline(10, color='orange', linestyle=':', alpha=0.6, label='10 mmHg')
            if self.best_epoch > 0:
                ax1.axvline(self.best_epoch, color='gray', linestyle='--', alpha=0.5)
            ax1.set_title(f'MAE (mmHg) — Epoch {len(eps)}')
            ax1.set_xlabel('Epoch'); ax1.set_ylabel('MAE (mmHg)')
            ax1.legend(fontsize=8); ax1.grid(True, alpha=0.3)
            ax2.plot(eps, self.train_losses, label='Train', color='steelblue')
            ax2.plot(eps, self.val_losses,   label='Val',   color='coral')
            if self.best_epoch > 0:
                ax2.axvline(self.best_epoch, color='gray', linestyle='--', alpha=0.5,
                            label=f'Best ep {self.best_epoch}')
            ax2.set_title('Huber Loss')
            ax2.set_xlabel('Epoch'); ax2.set_ylabel('Loss')
            ax2.legend(fontsize=8); ax2.grid(True, alpha=0.3)
            fig.suptitle(f'cBP-Tnet — Best val SBP: {self.best_sbp_mae:.1f}  '
                         f'DBP: {self.best_dbp_mae:.1f} mmHg', fontsize=12)
            fig.tight_layout()
            fig.savefig(self.loss_plot_path, dpi=100, bbox_inches='tight')
            plt.close(fig)
        except Exception:
            pass

    def train_model(self, grad_clip=4.0):
        pbar = tqdm(range(self.epochs), desc="Training cBP-Tnet")
        for epoch in pbar:
            tr_loss, tr_sbp, tr_dbp = self._run_epoch(self.train_loader, True,  grad_clip)
            vl_loss, vl_sbp, vl_dbp = self._run_epoch(self.val_loader,   False, grad_clip)

            if np.isnan(tr_loss) or np.isnan(vl_loss):
                print(f"\nNaN at epoch {epoch+1} — stopping."); break

            self.scheduler.step()
            self.train_losses.append(tr_loss);   self.val_losses.append(vl_loss)
            self.train_sbp_maes.append(tr_sbp);  self.val_sbp_maes.append(vl_sbp)
            self.train_dbp_maes.append(tr_dbp);  self.val_dbp_maes.append(vl_dbp)

            combined = vl_sbp + vl_dbp
            if combined < self.best_combined_mae - self.min_delta:
                self.best_combined_mae = combined
                self.best_val_loss     = vl_loss
                self.best_epoch        = epoch + 1
                self.best_sbp_mae      = vl_sbp
                self.best_dbp_mae      = vl_dbp
                self.epochs_no_improve = 0
                torch.save(self.model.state_dict(), self.save_path)
            else:
                self.epochs_no_improve += 1

            lr_now = self.optimizer.param_groups[0]['lr']
            pbar.set_postfix({
                'SBP': f"{tr_sbp:.1f}↓{vl_sbp:.1f}",
                'DBP': f"{tr_dbp:.1f}↓{vl_dbp:.1f}",
                'Best_SBP': f"{self.best_sbp_mae:.1f}",
                'NoImp': self.epochs_no_improve,
                'LR': f"{lr_now:.1e}",
            })

            if (epoch + 1) % 10 == 0 or self.epochs_no_improve >= self.patience:
                self._save_live_loss_plot()

            if self.epochs_no_improve >= self.patience:
                print(f"\nEarly stopping at epoch {epoch+1}. "
                      f"Best val SBP={self.best_sbp_mae:.1f}  "
                      f"DBP={self.best_dbp_mae:.1f}  (epoch {self.best_epoch})")
                break


# =====================================
# Module 10: Inference & Metrics
# =====================================

def predict(model, loader, device):
    model.eval()
    sbp_p, dbp_p, sbp_t, dbp_t, sids = [], [], [], [], []
    with torch.no_grad():
        for batch_X, batch_y, batch_ptt, batch_sid in loader:
            out = model(batch_X.to(device), batch_ptt.to(device)).cpu().numpy()
            sbp_p.extend(out[:, 0]);    dbp_p.extend(out[:, 1])
            sbp_t.extend(batch_y[:, 0].numpy())
            dbp_t.extend(batch_y[:, 1].numpy())
            sids.extend(batch_sid.numpy() if hasattr(batch_sid, 'numpy') else batch_sid)
    return (np.array(sbp_p), np.array(dbp_p),
            np.array(sbp_t), np.array(dbp_t),
            np.array(sids))


def calculate_metrics(predictions, targets):
    mae = np.mean(np.abs(predictions - targets))
    cc  = np.corrcoef(predictions, targets)[0, 1] if len(predictions) > 1 else 0.0
    return mae, cc


def AAMI_standard(pred, test):
    return len(pred), np.mean(pred - test), np.mean(np.abs(pred - test)), np.std(pred - test)


def BHS_standard(pred, test):
    diff = np.abs(pred - test); total = len(pred)
    return total, np.sum(diff <= 5), np.sum(diff <= 10), np.sum(diff <= 15)


def print_results(tag, sbp_p, dbp_p, sbp_t, dbp_t):
    # Remove NaNs (from held-out eval)
    mask = ~(np.isnan(sbp_p) | np.isnan(dbp_p))
    sbp_p, dbp_p, sbp_t, dbp_t = sbp_p[mask], dbp_p[mask], sbp_t[mask], dbp_t[mask]
    if len(sbp_p) == 0:
        print(f"\n=== {tag} ===  (no data)"); return 999.0, 999.0

    sm, sc = calculate_metrics(sbp_p, sbp_t)
    dm, dc = calculate_metrics(dbp_p, dbp_t)
    print(f"\n=== {tag} ===  (N={len(sbp_p):,})")
    print(f"  SBP  MAE: {sm:.2f} mmHg   CC: {sc:.3f}")
    print(f"  DBP  MAE: {dm:.2f} mmHg   CC: {dc:.3f}")
    for bp, pred, true in [('SBP', sbp_p, sbp_t), ('DBP', dbp_p, dbp_t)]:
        total, ME, MAE, SD = AAMI_standard(pred, true)
        total, m5, m10, m15 = BHS_standard(pred, true)
        print(f"  {bp} AAMI: ME={ME:.2f}  SD={SD:.2f}  MAE={MAE:.2f}")
        print(f"  {bp} BHS:  <5={m5/total*100:.1f}%  <10={m10/total*100:.1f}%  <15={m15/total*100:.1f}%")
    return sm, dm


# =====================================
# Module 11: Visualization
# =====================================

def save_fig(out_dir, filename):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, filename)
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Saved: {path}")


def plot_scatter(preds, actuals, out_dir, bp_type='SBP', tag=''):
    mask = ~np.isnan(preds)
    preds, actuals = preds[mask], actuals[mask]
    if len(preds) == 0: return
    plt.figure(figsize=(8, 6))
    plt.scatter(actuals, preds, alpha=0.2, s=4, color='steelblue')
    slope, intercept, r, *_ = linregress(actuals, preds)
    xs = np.array([actuals.min(), actuals.max()])
    plt.plot(xs, slope * xs + intercept, 'r-',
             label=f'y={slope:.2f}x+{intercept:.2f}  r={r:.3f}')
    plt.plot(xs, xs, 'k--', alpha=0.3, label='Identity')
    plt.xlabel(f'Actual {bp_type} (mmHg)')
    plt.ylabel(f'Predicted {bp_type} (mmHg)')
    plt.title(f'{bp_type} Predicted vs Actual {tag}')
    plt.legend(); plt.grid(True)
    safe = (bp_type + '_' + tag).replace(' ', '_').replace('(', '').replace(')', '')
    save_fig(out_dir, f'scatter_{safe}.png')


def plot_calibration_improvement(sbp_unc, sbp_cal, sbp_true,
                                 dbp_unc, dbp_cal, dbp_true, out_dir):
    cats = ['SBP\n(uncal)', 'SBP\n(cal)', 'DBP\n(uncal)', 'DBP\n(cal)']
    maes = [np.mean(np.abs(sbp_unc - sbp_true)),
            np.mean(np.abs(sbp_cal - sbp_true)),
            np.mean(np.abs(dbp_unc - dbp_true)),
            np.mean(np.abs(dbp_cal - dbp_true))]
    colors = ['#4878CF', '#6ACC65', '#4878CF', '#6ACC65']
    plt.figure(figsize=(8, 5))
    bars = plt.bar(cats, maes, color=colors, edgecolor='white', linewidth=1.5)
    for bar, mae in zip(bars, maes):
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.2,
                 f'{mae:.1f}', ha='center', va='bottom', fontsize=11, fontweight='bold')
    plt.axhline(5,  color='green',  linestyle='--', alpha=0.5, label='5 mmHg')
    plt.axhline(10, color='orange', linestyle='--', alpha=0.5, label='10 mmHg')
    plt.ylabel('MAE (mmHg)'); plt.title('MAE: Uncalibrated vs Calibrated (K=5)')
    plt.legend(); plt.grid(True, axis='y', alpha=0.3)
    save_fig(out_dir, 'calibration_improvement.png')


def plot_train_val_loss(trainer, out_dir):
    epochs = range(1, len(trainer.train_losses) + 1)
    plt.figure(figsize=(10, 5))
    plt.plot(epochs, trainer.train_losses, label='Train Loss')
    plt.plot(epochs, trainer.val_losses,   label='Val Loss')
    plt.axvline(trainer.best_epoch, color='r', linestyle=':',
                label=f'Best (ep {trainer.best_epoch})')
    plt.title('cBP-Tnet v4 — Loss Curve')
    plt.xlabel('Epoch'); plt.ylabel('Loss'); plt.legend(); plt.grid(True)
    save_fig(out_dir, 'train_val_loss.png')


# =====================================
# Module 12: Cache
# =====================================

def process_split(dataset_paths, split, sample_freq, window_size, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    cache_file = os.path.join(cache_dir,
        f"v4final_{split}_sf{sample_freq}_ws{window_size}.npz")

    if os.path.exists(cache_file):
        d = np.load(cache_file, allow_pickle=True)
        if len(d['beats']) == 0:
            os.remove(cache_file)
        else:
            print(f"  Loading cache ({split}): {len(d['beats'])} beats")
            return d['beats'], d['SBP'], d['DBP'], d['PTT'], d['subject_ids']

    print(f"  No cache for '{split}'. Running preprocessing...")
    PPG_list, ABP_list, SBP_list, DBP_list = load_dataset(dataset_paths, split)
    beats, SBP, DBP, PTT, SUBJ = generate_features(
        PPG_list, ABP_list, SBP_list, DBP_list,
        sample_freq=sample_freq, window_size=window_size)

    np.savez_compressed(cache_file,
                        beats=beats.astype(np.float32),
                        SBP=SBP.astype(np.float32),
                        DBP=DBP.astype(np.float32),
                        PTT=PTT.astype(np.float32),
                        subject_ids=SUBJ.astype(np.int32))
    print(f"  Cache saved ({os.path.getsize(cache_file)/1e6:.1f} MB)")
    return beats, SBP, DBP, PTT, SUBJ


# =====================================
# Module 13: Main
# =====================================

def main():
    BASE_DIR   = os.environ.get('BASE_DIR', os.path.expanduser('~/cdd'))
    OUT_DIR    = os.path.join(BASE_DIR, 'outputs')
    CACHE_DIR  = os.path.join(BASE_DIR, 'mimic_bp', 'feature_cache')
    MODEL_PATH = os.path.join(OUT_DIR, 'cBP-Tnet_Model.pth')
    EDGE_PATH  = os.path.join(OUT_DIR, 'cBP-Tnet_Edge_Model.pt')
    os.makedirs(OUT_DIR, exist_ok=True)

    # ── Config (identical to job 27694515) ────────────────────────────
    SAMPLE_FREQ  = MIMIC_BP_SAMPLE_FREQ   # 125 Hz
    WINDOW_SIZE  = 2 * SAMPLE_FREQ        # 250 samples
    EPOCHS       = 500
    PATIENCE     = 80
    LR           = 3e-4
    BATCH_SIZE   = 256
    MODEL_DIM    = 256
    DROPOUT      = 0.35
    NUM_HEADS    = 8
    NUM_LAYERS   = 6
    WARMUP_EPOCHS = 10
    BEATS_PER_SUBJ_PER_EPOCH = 30
    K_CAL        = 5   # calibration reference beats per subject

    # Auto-clear cache so preprocessing always runs fresh
    import glob as _glob
    stale = _glob.glob(os.path.join(CACHE_DIR, '*.npz'))
    if stale:
        print(f"\nClearing {len(stale)} stale cache file(s)...")
        for f in stale: os.remove(f)

    set_random_seeds(125)

    # ── Step 1: Dataset ───────────────────────────────────────────────
    dataset_paths = find_dataset(BASE_DIR)

    # ── Step 2: Feature extraction ────────────────────────────────────
    print("\n=== Processing TRAIN split ===")
    X_train, SBP_train, DBP_train, PTT_train, SUBJ_train = \
        process_split(dataset_paths, 'train', SAMPLE_FREQ, WINDOW_SIZE, CACHE_DIR)

    print("\n=== Processing VAL split ===")
    X_val, SBP_val, DBP_val, PTT_val, SUBJ_val = \
        process_split(dataset_paths, 'val', SAMPLE_FREQ, WINDOW_SIZE, CACHE_DIR)

    print("\n=== Processing TEST split ===")
    X_test, SBP_test, DBP_test, PTT_test, SUBJ_test = \
        process_split(dataset_paths, 'test', SAMPLE_FREQ, WINDOW_SIZE, CACHE_DIR)

    # ── Step 3: Normalization ─────────────────────────────────────────
    print("\nNormalizing channel-wise (fit on train)...")
    X_train_n, X_val_n, X_test_n, _, _, PTT_train_n, PTT_val_n, PTT_test_n = \
        normalize_beats(X_train, X_val, X_test, PTT_train, PTT_val, PTT_test)
    print(f"  Train: {X_train_n.shape}  Val: {X_val_n.shape}  Test: {X_test_n.shape}")

    # ── Step 4: DataLoaders ───────────────────────────────────────────
    def collate(batch):
        Xs, ys, ptts, sids = zip(*batch)
        return (torch.stack(Xs), torch.stack(ys),
                torch.stack(ptts), torch.tensor(sids, dtype=torch.long))

    train_ds = BloodPressureDataset(X_train_n, SBP_train, DBP_train,
                                    PTT_train_n, SUBJ_train, augment=True)
    val_ds   = BloodPressureDataset(X_val_n,   SBP_val,   DBP_val,
                                    PTT_val_n,  SUBJ_val,  augment=False)
    test_ds  = BloodPressureDataset(X_test_n,  SBP_test,  DBP_test,
                                    PTT_test_n, SUBJ_test, augment=False)

    train_sampler = SubjectStratifiedSampler(SUBJ_train, BEATS_PER_SUBJ_PER_EPOCH)
    print(f"\n  SubjectStratifiedSampler: {BEATS_PER_SUBJ_PER_EPOCH} beats/subject/epoch "
          f"→ {len(train_sampler):,} beats/epoch  ({len(np.unique(SUBJ_train))} subjects)")

    train_loader = Data.DataLoader(train_ds, batch_size=BATCH_SIZE,
                                   sampler=train_sampler, collate_fn=collate,
                                   num_workers=4, pin_memory=True)
    val_loader   = Data.DataLoader(val_ds,  batch_size=BATCH_SIZE, shuffle=False,
                                   collate_fn=collate, num_workers=4, pin_memory=True)
    test_loader  = Data.DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False,
                                   collate_fn=collate, num_workers=4, pin_memory=True)

    # ── Step 5: Model ─────────────────────────────────────────────────
    model = CNNTransformerBP(
        in_channels=3, window_size=WINDOW_SIZE,
        model_dim=MODEL_DIM, num_heads=NUM_HEADS,
        num_layers=NUM_LAYERS, dropout=DROPOUT, ptt_dim=32)

    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\ncBP-Tnet v4  |  Trainable params: {n_params:,}")

    # ── Step 6: Train ─────────────────────────────────────────────────
    trainer = Trainer(model, train_loader, val_loader,
                      epochs=EPOCHS, lr=LR, save_path=MODEL_PATH,
                      patience=PATIENCE, warmup_epochs=WARMUP_EPOCHS)
    trainer.loss_plot_path = os.path.join(OUT_DIR, 'loss_live.png')
    trainer.train_model(grad_clip=4.0)

    model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
    print(f"\nBest model: epoch {trainer.best_epoch}  "
          f"val SBP={trainer.best_sbp_mae:.2f}  DBP={trainer.best_dbp_mae:.2f}")

    # ── Step 7: Evaluate — uncalibrated ──────────────────────────────
    SBP_val_p,  DBP_val_p,  SBP_val_t,  DBP_val_t,  SUBJ_val_p  = predict(model, val_loader,  DEVICE)
    SBP_test_p, DBP_test_p, SBP_test_t, DBP_test_t, SUBJ_test_p = predict(model, test_loader, DEVICE)

    print_results("Validation (uncalibrated)", SBP_val_p,  DBP_val_p,  SBP_val_t,  DBP_val_t)
    sbp_unc, dbp_unc = print_results(
        "Test (uncalibrated)", SBP_test_p, DBP_test_p, SBP_test_t, DBP_test_t)

    # ── Step 8: Per-subject calibration ──────────────────────────────
    print(f"\nApplying per-subject calibration (K={K_CAL} reference beats)...")
    SBP_test_cal, DBP_test_cal, SBP_test_ho, DBP_test_ho = calibrate_predictions(
        SBP_test_p, DBP_test_p, SBP_test_t, DBP_test_t, SUBJ_test_p, k_cal=K_CAL)

    # Full calibrated (all beats shifted)
    sbp_cal, dbp_cal = print_results(
        "Test (calibrated, all beats)",
        SBP_test_cal, DBP_test_cal, SBP_test_t, DBP_test_t)

    # Held-out calibrated (cal beats excluded — honest metric)
    mask_ho = ~np.isnan(SBP_test_ho)
    print_results(
        "Test (calibrated, held-out only — honest metric)",
        SBP_test_ho, DBP_test_ho, SBP_test_t, DBP_test_t)

    # ── Step 9: Summary ───────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("FINAL SUMMARY")
    print("=" * 60)
    rows = [
        {'Model': 'cBP-Tnet v4 (uncalibrated)', 'SBP MAE': sbp_unc,  'DBP MAE': dbp_unc},
        {'Model': 'cBP-Tnet v4 (calibrated)',   'SBP MAE': sbp_cal,  'DBP MAE': dbp_cal},
    ]
    print(pd.DataFrame(rows).to_string(index=False))

    # ── Step 10: Plots ────────────────────────────────────────────────
    plot_scatter(SBP_test_p,   SBP_test_t, OUT_DIR, 'SBP', 'uncal')
    plot_scatter(SBP_test_cal, SBP_test_t, OUT_DIR, 'SBP', 'cal')
    plot_scatter(DBP_test_p,   DBP_test_t, OUT_DIR, 'DBP', 'uncal')
    plot_scatter(DBP_test_cal, DBP_test_t, OUT_DIR, 'DBP', 'cal')
    plot_calibration_improvement(SBP_test_p, SBP_test_cal, SBP_test_t,
                                 DBP_test_p, DBP_test_cal, DBP_test_t, OUT_DIR)
    plot_train_val_loss(trainer, OUT_DIR)

    # ── Step 11: Edge export ──────────────────────────────────────────
    print("\nExporting TorchScript edge model...")
    model.eval()
    try:
        dummy_x   = torch.zeros(1, 3, WINDOW_SIZE).to(DEVICE)
        dummy_ptt = torch.zeros(1, 2).to(DEVICE)
        with torch.no_grad():
            traced = torch.jit.trace(model, (dummy_x, dummy_ptt))
        traced.save(EDGE_PATH)
        print(f"  Edge model saved: {EDGE_PATH}")
    except Exception as e:
        print(f"  TorchScript export failed: {e}")

    print(f"\nAll outputs → {OUT_DIR}")


if __name__ == "__main__":
    main()
