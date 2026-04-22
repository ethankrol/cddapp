import Foundation

@objc(BloodPressureModule)
class BloodPressureModule: NSObject {
  private var modelLoaded = false
  private let modelVersion = "1.0.0"
  
  /**
   * Load the blood pressure prediction model
   * In a real implementation, this would load a Core ML model file
   */
  @objc
  func loadModel(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    do {
      // TODO: Load Core ML model here
      // Example: let model = try YourBloodPressureModel(configuration: MLModelConfiguration())
      
      self.modelLoaded = true
      resolve(true)
    } catch {
      reject("MODEL_LOAD_ERROR", "Failed to load blood pressure model: \(error.localizedDescription)", error)
    }
  }
  
  /**
   * Check if the model is ready for predictions
   */
  @objc
  func isModelReady(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(self.modelLoaded)
  }
  
  /**
   * Get metadata about the loaded model
   */
  @objc
  func getModelInfo(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let info: [String: Any] = [
      "version": self.modelVersion,
      "name": "BloodPressureModel",
      "platform": "iOS",
      "inputFeatures": ["systolic", "diastolic", "heartRate", "age", "weight", "height"],
      "supportedRiskLevels": ["normal", "elevated", "hypertension_stage1", "hypertension_stage2"],
      "ready": self.modelLoaded
    ]
    resolve(info)
  }
  
  /**
   * Predict blood pressure from a complete reading
   */
  @objc
  func predictReading(
    reading: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard self.modelLoaded else {
      reject("MODEL_NOT_LOADED", "Model must be loaded before making predictions", nil)
      return
    }
    
    do {
      // Validate and extract input
      guard let systolic = reading["systolic"] as? NSNumber,
            let diastolic = reading["diastolic"] as? NSNumber,
            let heartRate = reading["heartRate"] as? NSNumber,
            let age = reading["age"] as? NSNumber,
            let weight = reading["weight"] as? NSNumber,
            let height = reading["height"] as? NSNumber else {
        throw NSError(domain: "Invalid input parameters", code: 400)
      }
      
      // TODO: Run actual Core ML prediction here
      // Example: let input = YourBloodPressureModelInput(systolic: systolic, ...)
      // let output = try model.prediction(input: input)
      
      // For now, return stub prediction
      let prediction = self.generateStubPrediction(
        systolic: systolic.doubleValue,
        diastolic: diastolic.doubleValue
      )
      
      resolve(prediction)
    } catch {
      reject("PREDICTION_ERROR", "Failed to make prediction: \(error.localizedDescription)", error)
    }
  }
  
  /**
   * Predict from raw feature values
   */
  @objc
  func predictFeatures(
    features: [String: Any],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard self.modelLoaded else {
      reject("MODEL_NOT_LOADED", "Model must be loaded before making predictions", nil)
      return
    }
    
    do {
      // TODO: Run predictions on preprocessed features
      let prediction = self.generateStubPrediction(
        systolic: (features["systolic"] as? NSNumber)?.doubleValue ?? 120,
        diastolic: (features["diastolic"] as? NSNumber)?.doubleValue ?? 80
      )
      resolve(prediction)
    } catch {
      reject("PREDICTION_ERROR", "Failed to make prediction: \(error.localizedDescription)", error)
    }
  }
  
  /**
   * Warm up the model with a dummy prediction to improve latency
   */
  @objc
  func warmUpModel(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    guard self.modelLoaded else {
      reject("MODEL_NOT_LOADED", "Model must be loaded before warm-up", nil)
      return
    }
    
    // TODO: Run a dummy prediction to warm up the model
    resolve(nil)
  }
  
  // MARK: - Helper methods
  
  private func generateStubPrediction(systolic: Double, diastolic: Double) -> [String: Any] {
    let riskLevel = determineRiskLevel(systolic: systolic, diastolic: diastolic)
    
    return [
      "riskLevel": riskLevel,
      "systolicPrediction": systolic,
      "diastolicPrediction": diastolic,
      "confidence": 0.85,
      "modelVersion": self.modelVersion,
      "timeMs": Int(Date().timeIntervalSince1970 * 1000)
    ]
  }
  
  private func determineRiskLevel(systolic: Double, diastolic: Double) -> String {
    if systolic < 120 && diastolic < 80 {
      return "normal"
    } else if systolic < 130 && diastolic < 80 {
      return "elevated"
    } else if systolic < 140 || diastolic < 90 {
      return "hypertension_stage1"
    } else {
      return "hypertension_stage2"
    }
  }
}
