/**
 * ==============================================================================
 * MyoMotion — ESP32 Unified Kinematics & sEMG Firmware (v3.1)
 * ==============================================================================
 * Dual BNO055 (IMUPLUS 6-DOF) + MyoWare 2.0 Muscle Sensor (ENV) Biofeedback
 * Focused on 2 Sagittal Rehab Exercises:
 *   1) Elbow Curl (Biceps)        -> 1-DoF Quaternion Angle + Biceps sEMG
 *   2) Wrist Curl (Forearm)       -> 1-DoF Sagittal Pitch + Bottom/Top ROM + Forearm sEMG
 *
 * WiFi & MQTT provisioning via WiFiManager Captive Portal (20s timeout, auto-saved)
 * Communicating via MQTT (PubSubClient) with LWT and 20 Hz Telemetry
 *
 * MQTT Commands ("myomotion/cmd/<MAC>"):
 * - "mode:elbow"        -> Arm Elbow Curl mode & zero baseline
 * - "mode:wrist"        -> Arm Wrist Curl mode & zero baseline
 * - "mode:idle" / "stop"-> Disarm to standby IDLE
 * - "tare" / "zero"     -> Zero active joint baseline (0 degrees)
 * - "elbow:min"         -> Save current elbow angle as Straightest Position (Min)
 * - "elbow:max"         -> Save current elbow angle as Max Flexed Position (Max)
 * - "elbow:reset"       -> Reset Elbow Min/Max limits to defaults (0 / 120)
 * - "wrist:bottom"      -> Save current wrist pitch as Lowest Position (Bottom)
 * - "wrist:top"         -> Save current wrist pitch as Highest Position (Top)
 * - "wrist:reset"       -> Reset Wrist Bottom/Top limits to defaults (-40 / +40)
 * - "baseline" / "relax"-> Capture MyoWare RELAX baseline (0%)
 * - "calibrate" / "peak"-> Capture MyoWare PEAK (100% over 3s)
 * - "reset"             -> Reset MyoWare calibration to full 12-bit range
 *
 * Hardware Wiring:
 * - Microcontroller: ESP32 DevKit
 * - Sensor 1 (Proximal / Reference): I2C Bus 0 (SDA: GPIO 21, SCL: GPIO 22, Addr: 0x29)
 * - Sensor 2 (Distal / Dynamic):    I2C Bus 1 (SDA: GPIO 18, SCL: GPIO 19, Addr: 0x29)
 * - MyoWare 2.0 ENV (Envelope) -> GPIO 32
 * ==============================================================================
 */

#include <WiFi.h>
#include <WiFiManager.h>          // https://github.com/tzapu/WiFiManager
#include <Preferences.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>

// --- 1. MQTT Broker Configuration (Provisioned via Captive Portal) ---
char mqtt_server[64] = "YOUR_MQTT_BROKER_IP";
char mqtt_port_str[8] = "1892";
int  mqtt_port = 1892;

WiFiClient    espClient;
PubSubClient  mqttClient(espClient);
WiFiManager   wifiManager;
Preferences   preferences;

// --- 2. Pin Assignments & Bus Configurations ---
#define I2C_SDA_PIN_1 21
#define I2C_SCL_PIN_1 22
#define I2C_SDA_PIN_2 18
#define I2C_SCL_PIN_2 19

#define BNO055_I2C_ADDR 0x29
#define EMG_ADC_PIN 32

// Secondary physical I2C instance on ESP32
TwoWire I2C_Bus2 = TwoWire(1);

// Sensor instances
Adafruit_BNO055 bnoProximal = Adafruit_BNO055(55, BNO055_I2C_ADDR, &Wire);
Adafruit_BNO055 bnoDistal   = Adafruit_BNO055(56, BNO055_I2C_ADDR, &I2C_Bus2);

// --- 3. Operational Mode & Kinematics Variables ---
enum PipelineMode { MODE_IDLE, MODE_ELBOW, MODE_WRIST };
PipelineMode currentMode = MODE_IDLE;

// Biomechanical zero-reference orientation offsets
imu::Quaternion qInitialOffset;

// Low-pass exponential moving average filter variables (Alpha = 0.20)
const float FILTER_ALPHA = 0.20;
float smoothedElbowAngle = 0.0;
float smoothedWristPitch = 0.0;

// Elbow Curl calibrated ROM boundaries (Min = straightest, Max = most flexed)
float elbowMinAngle =   0.0;
float elbowMaxAngle = 120.0;

// Wrist Curl calibrated ROM boundaries (Bottom = lowest, Top = highest)
float wristBottomPitch = -40.0;
float wristTopPitch    =  40.0;

// Telemetry transmission timing (20 Hz = 50ms)
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 50;

// --- 4. MyoWare 2.0 EMG Biofeedback Signal Extraction ---
int emgBaselineRaw = 0;      // RELAX reference -> represents 0% activation
int emgPeakRaw     = 4095;   // MAX GRIP reference -> represents 100% activation
bool isCalibratingPeak = false;
unsigned long peakCalibrateStart = 0;
int peakCalibrateMax = 0;

// Dynamic MQTT Topic Strings (based on MAC)
String macAddress = "";
String topicTelemetry = "";
String topicStatus    = "";
String topicCommand   = "";

bool shouldSaveConfig = false;

void saveConfigCallback() {
  shouldSaveConfig = true;
}

// ==============================================================================
// MYOWARE 2.0 EMG HELPERS
// ==============================================================================

int readSmoothedADC() {
  long sum = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(EMG_ADC_PIN);
    delayMicroseconds(250);
  }
  return sum / samples;
}

void performRelaxBaselineCalibration() {
  emgBaselineRaw = readSmoothedADC();
  if (emgPeakRaw <= emgBaselineRaw) {
    emgPeakRaw = emgBaselineRaw + 100;
  }
  Serial.printf("[CALIBRATION] MyoWare RELAX baseline set: %d (0%%)\n", emgBaselineRaw);
}

void beginPeakCalibration() {
  isCalibratingPeak = true;
  peakCalibrateStart = millis();
  peakCalibrateMax = 0;
  Serial.println("[COMMAND] 3-Second MyoWare MAX GRIP Capture Initiated!");
}

void resetMyoWareCalibration() {
  emgBaselineRaw = 0;
  emgPeakRaw = 4095;
  Serial.println("[COMMAND] MyoWare calibration reset to full range.");
}

float computePctMVC(int rawValue) {
  if (emgPeakRaw <= emgBaselineRaw) {
    return 0.0f;
  }
  float pct = ((float)(rawValue - emgBaselineRaw) / (float)(emgPeakRaw - emgBaselineRaw)) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 150.0f) pct = 150.0f;
  return pct;
}

// ==============================================================================
// CALIBRATION ROUTINES (Joint Kinematics)
// ==============================================================================

void performZeroCalibration() {
  imu::Quaternion qProx = bnoProximal.getQuat();
  imu::Quaternion qDist = bnoDistal.getQuat();

  qInitialOffset = qProx.conjugate() * qDist;
  qInitialOffset.normalize();

  smoothedElbowAngle = 0.0;
  smoothedWristPitch = 0.0;
  Serial.println("[CALIBRATION] Joint baseline zeroed successfully (0 deg).");
}

// ==============================================================================
// MQTT COMMAND HANDLER
// ==============================================================================

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String cmd = "";
  for (unsigned int i = 0; i < length; i++) {
    cmd += (char)payload[i];
  }
  cmd.trim();
  Serial.printf("[MQTT CMD] Received command: %s\n", cmd.c_str());

  if (cmd.equalsIgnoreCase("tare") || cmd.equalsIgnoreCase("zero")) {
    performZeroCalibration();
  } else if (cmd.equalsIgnoreCase("elbow:min")) {
    elbowMinAngle = smoothedElbowAngle;
    Serial.printf("[CALIBRATION] Elbow STRAIGHT (Min) position set: %.1f deg\n", elbowMinAngle);
  } else if (cmd.equalsIgnoreCase("elbow:max")) {
    elbowMaxAngle = smoothedElbowAngle;
    Serial.printf("[CALIBRATION] Elbow MAX FLEX (Max) position set: %.1f deg\n", elbowMaxAngle);
  } else if (cmd.equalsIgnoreCase("elbow:reset")) {
    elbowMinAngle =   0.0;
    elbowMaxAngle = 120.0;
    Serial.println("[CALIBRATION] Elbow Min/Max limits reset to 0.0 / 120.0 deg.");
  } else if (cmd.equalsIgnoreCase("wrist:bottom")) {
    wristBottomPitch = smoothedWristPitch;
    Serial.printf("[CALIBRATION] Wrist Curl BOTTOM position set: %.1f deg\n", wristBottomPitch);
  } else if (cmd.equalsIgnoreCase("wrist:top")) {
    wristTopPitch = smoothedWristPitch;
    Serial.printf("[CALIBRATION] Wrist Curl TOP position set: %.1f deg\n", wristTopPitch);
  } else if (cmd.equalsIgnoreCase("wrist:reset")) {
    wristBottomPitch = -40.0;
    wristTopPitch    =  40.0;
    Serial.println("[CALIBRATION] Wrist Curl Bottom/Top limits reset to -40.0 / +40.0 deg.");
  } else if (cmd.equalsIgnoreCase("baseline") || cmd.equalsIgnoreCase("relax")) {
    performRelaxBaselineCalibration();
  } else if (cmd.equalsIgnoreCase("calibrate") || cmd.equalsIgnoreCase("peak")) {
    beginPeakCalibration();
  } else if (cmd.equalsIgnoreCase("reset")) {
    resetMyoWareCalibration();
  } else if (cmd.equalsIgnoreCase("mode:elbow")) {
    if (currentMode != MODE_ELBOW) {
      currentMode = MODE_ELBOW;
      performZeroCalibration();
      Serial.println("[COMMAND] Pipeline armed: ELBOW CURL (1-DoF)");
    }
  } else if (cmd.equalsIgnoreCase("mode:wrist")) {
    if (currentMode != MODE_WRIST) {
      currentMode = MODE_WRIST;
      performZeroCalibration();
      Serial.println("[COMMAND] Pipeline armed: WRIST CURL (Sagittal 1-DoF)");
    }
  } else if (cmd.equalsIgnoreCase("mode:idle") || cmd.equalsIgnoreCase("stop")) {
    currentMode = MODE_IDLE;
    Serial.println("[COMMAND] Pipeline disarmed: IDLE (standby)");
  }
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting to broker...");
    String clientId = "MyoMotion-Node-" + macAddress;

    if (mqttClient.connect(clientId.c_str(), NULL, NULL, topicStatus.c_str(), 1, true, "offline")) {
      Serial.println(" CONNECTED!");
      mqttClient.publish(topicStatus.c_str(), "online", true);
      mqttClient.subscribe(topicCommand.c_str(), 1);
      Serial.printf("[MQTT] Subscribed to command topic: %s\n", topicCommand.c_str());
    } else {
      Serial.printf(" FAILED, rc=%d. Retrying in 4s...\n", mqttClient.state());
      delay(4000);
    }
  }
}

// ==============================================================================
// SETUP
// ==============================================================================

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000);
  delay(200);

  Serial.println("\n==================================================");
  Serial.println("  MYOMOTION MEDICAL — ESP32 FIRMWARE v3.1         ");
  Serial.println("  Elbow Curl & Wrist Curl (MyoWare 2.0 + BNO055)  ");
  Serial.println("==================================================");

  // Load saved MQTT settings from NVS
  preferences.begin("myomotion", true);
  String savedHost = preferences.getString("mqtt_host", "YOUR_MQTT_BROKER_IP");
  String savedPort = preferences.getString("mqtt_port", "1892");
  preferences.end();

  savedHost.toCharArray(mqtt_server, sizeof(mqtt_server));
  savedPort.toCharArray(mqtt_port_str, sizeof(mqtt_port_str));

  WiFiManagerParameter custom_mqtt_server("server", "MQTT Broker Host / IP", mqtt_server, 64);
  WiFiManagerParameter custom_mqtt_port("port", "MQTT Broker Port", mqtt_port_str, 8);

  wifiManager.setSaveConfigCallback(saveConfigCallback);
  wifiManager.addParameter(&custom_mqtt_server);
  wifiManager.addParameter(&custom_mqtt_port);
  wifiManager.setConfigPortalTimeout(20);  // 20s captive portal timeout

  Serial.println("[WIFI] Launching WiFiManager provisioning...");
  if (!wifiManager.autoConnect("MyoMotionAP")) {
    Serial.println("[WIFI] Config portal timeout. Rebooting ESP32...");
    delay(1000);
    ESP.restart();
  }

  if (shouldSaveConfig) {
    strncpy(mqtt_server, custom_mqtt_server.getValue(), sizeof(mqtt_server) - 1);
    strncpy(mqtt_port_str, custom_mqtt_port.getValue(), sizeof(mqtt_port_str) - 1);
    preferences.begin("myomotion", false);
    preferences.putString("mqtt_host", String(mqtt_server));
    preferences.putString("mqtt_port", String(mqtt_port_str));
    preferences.end();
  }
  mqtt_port = atoi(mqtt_port_str);
  if (mqtt_port <= 0) mqtt_port = 1892;

  Serial.printf("[WIFI] Connected to: %s\n", WiFi.SSID().c_str());
  Serial.printf("[MQTT] Configured Broker: %s:%d\n", mqtt_server, mqtt_port);

  // Initialize Dual I2C Buses
  Wire.begin(I2C_SDA_PIN_1, I2C_SCL_PIN_1);
  I2C_Bus2.begin(I2C_SDA_PIN_2, I2C_SCL_PIN_2);

  if (!bnoProximal.begin()) {
    Serial.println("[ERROR] Proximal sensor initialization failed.");
    while (1) { delay(1000); }
  }

  if (!bnoDistal.begin()) {
    Serial.println("[ERROR] Distal sensor initialization failed.");
    while (1) { delay(1000); }
  }

  bnoProximal.setMode(OPERATION_MODE_IMUPLUS);
  bnoDistal.setMode(OPERATION_MODE_IMUPLUS);
  bnoProximal.setExtCrystalUse(true);
  bnoDistal.setExtCrystalUse(true);

  delay(1000);
  performZeroCalibration();

  // Setup MyoWare 2.0 EMG ADC (12-bit resolution 0 - 4095)
  pinMode(EMG_ADC_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(EMG_ADC_PIN, ADC_11db);
  performRelaxBaselineCalibration();

  // Compute Clean MAC
  macAddress = WiFi.macAddress();
  macAddress.replace(":", "");
  macAddress.toUpperCase();
  Serial.printf("[SYSTEM] Device Node MAC: %s\n", macAddress.c_str());

  // Setup Topics
  topicTelemetry = "myomotion/data/" + macAddress;
  topicStatus    = "myomotion/status/" + macAddress;
  topicCommand   = "myomotion/cmd/" + macAddress;

  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  Serial.printf("[SYSTEM] Node in IDLE mode. Awaiting mode command on: %s\n", topicCommand.c_str());
}

// ==============================================================================
// MAIN LOOP
// ==============================================================================

void loop() {
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  // --- 1. Continuous 1000 Hz MyoWare EMG Signal Extraction ---
  static unsigned long lastEMGSampleMicros = 0;
  if (micros() - lastEMGSampleMicros >= 1000) {
    lastEMGSampleMicros = micros();

    if (isCalibratingPeak) {
      int currentReading = analogRead(EMG_ADC_PIN);
      if (currentReading > peakCalibrateMax) {
        peakCalibrateMax = currentReading;
      }
      if (millis() - peakCalibrateStart > 3000) {
        if (peakCalibrateMax > emgBaselineRaw + 10) {
          emgPeakRaw = peakCalibrateMax;
          Serial.printf("[MVC] MyoWare MAX GRIP calibrated: %d (100%%)\n", emgPeakRaw);
        } else {
          Serial.println("[MVC] Squeeze effort too weak. Please retry.");
        }
        isCalibratingPeak = false;
        peakCalibrateMax = 0;
      }
    }
  }

  // --- 2. Telemetry Streaming Pipeline (20 Hz / 50ms) ---
  unsigned long currentMillis = millis();
  if (currentMillis - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = currentMillis;

    int latestRaw = readSmoothedADC();
    float percentMVC = computePctMVC(latestRaw);

    String json = "{";
    json += "\"mac\":\"" + macAddress + "\",";

    if (currentMode == MODE_IDLE) {
      json += "\"mode\":\"idle\",";
    } else {
      imu::Quaternion qProx = bnoProximal.getQuat();
      imu::Quaternion qDist = bnoDistal.getQuat();

      imu::Quaternion qRel = qProx.conjugate() * qDist;
      qRel.normalize();

      imu::Quaternion qJoint = qRel * qInitialOffset.conjugate();
      qJoint.normalize();

      if (currentMode == MODE_ELBOW) {
        float wComponent = constrain(abs(qJoint.w()), 0.0f, 1.0f);
        float rawAngle = 2.0f * acos(wComponent) * 180.0f / PI;
        smoothedElbowAngle = (FILTER_ALPHA * rawAngle) + ((1.0f - FILTER_ALPHA) * smoothedElbowAngle);

        json += "\"mode\":\"elbow\",";
        json += "\"angle\":" + String(smoothedElbowAngle, 1) + ",";
        json += "\"elbow_min\":" + String(elbowMinAngle, 1) + ",";
        json += "\"elbow_max\":" + String(elbowMaxAngle, 1) + ",";
      } else {
        float qw = qJoint.w(), qx = qJoint.x(), qy = qJoint.y(), qz = qJoint.z();
        float vx = 1.0f - 2.0f * (qy * qy + qz * qz);
        float vz = 2.0f * (qx * qz - qw * qy);

        float rawPitch = atan2(-vz, vx) * 180.0f / M_PI;
        smoothedWristPitch = (FILTER_ALPHA * rawPitch) + ((1.0f - FILTER_ALPHA) * smoothedWristPitch);

        json += "\"mode\":\"wrist\",";
        json += "\"pitch\":" + String(smoothedWristPitch, 1) + ",";
        json += "\"bottom\":" + String(wristBottomPitch, 1) + ",";
        json += "\"top\":" + String(wristTopPitch, 1) + ",";
      }
    }

    json += "\"raw\":" + String(latestRaw) + ",";
    json += "\"percent\":" + String(percentMVC, 1) + ",";
    json += "\"mvc\":" + String(emgPeakRaw) + ",";
    json += "\"baseline\":" + String(emgBaselineRaw) + ",";
    json += "\"calibrating\":" + String(isCalibratingPeak ? "true" : "false");
    json += "}";

    mqttClient.publish(topicTelemetry.c_str(), json.c_str(), false);
  }
}
