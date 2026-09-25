export type BpSmokeResult = {
  systolic: number;
  diastolic: number;
  expectedSystolic: number;
  expectedDiastolic: number;
  systolicDifference: number;
  diastolicDifference: number;
  tolerance: number;
  passed: boolean;
  inferenceMs: number;
  pairingVerified: boolean;
};
