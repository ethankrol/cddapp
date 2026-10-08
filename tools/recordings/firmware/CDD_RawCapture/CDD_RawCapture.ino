// Diagnostic capture for the SAME SparkFun Bio Sensor Hub setup as the supplied sketch.
// Confirm board, pins, installed library and sensor settings before flashing.
// This is NOT firmware for the earlier proposed SFH-7050A/ADXL366 board.
#include <SparkFun_Bio_Sensor_Hub_Library.h>
#include <Wire.h>
const int resPin = 2;
const int mfioPin = 1;
SparkFun_Bio_Sensor_Hub bioHub(resPin, mfioPin);
uint32_t emittedSequence = 0;

void stopWithError(const char *message, int code) {
  Serial.print("# ERROR "); Serial.print(message); Serial.print(' '); Serial.println(code);
  while (true) { delay(1000); }
}
void setup() {
  Serial.begin(115200);
  Wire.begin();
  int result = bioHub.begin();
  if (result != 0) stopWithError("begin", result);
  result = bioHub.configSensor();
  if (result != 0) stopWithError("configSensor", result);
  Serial.println("# cdd_raw_capture_v1; preprocessing=none; sample_rate_hz=unknown");
  Serial.println("# sequence counts emitted reads, NOT sensor acquisition samples");
  Serial.println("# read_started_us/read_finished_us are host readout times, NOT acquisition times");
  Serial.println("sequence,read_started_us,read_finished_us,fifo_available,red_counts,ir_counts");
  // No four-second pause accumulating unread samples after configuration.
}
void loop() {
  const uint8_t available = bioHub.numSamplesOutFifo();
  if (available == 0) { delay(1); return; }
  // Exactly one sensor read per emitted row. The old unconditional first read is removed.
  const uint32_t start = micros();
  const bioData sample = bioHub.readSensor();
  const uint32_t finish = micros();
  Serial.print(emittedSequence++); Serial.print(',');
  Serial.print(start); Serial.print(',');
  Serial.print(finish); Serial.print(',');
  Serial.print(available); Serial.print(',');
  Serial.print(sample.redLed); Serial.print(',');
  Serial.println(sample.irLed);
  // Preserve original counts: no baseline removal, clipping, normalization or interpolation.
  // The library's readSensor() does not expose its read status; this remains a diagnostic.
  // If FIFO occupancy grows, use a verified batch/interrupt driver, not invented timestamps.
}
