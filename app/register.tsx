import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
  Platform,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useState, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const getBackendUrl = () => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL || "https://tripsyncbackend-production-37a2.up.railway.app";
  let cleaned = envUrl.replace(/\/+$/, "");
  if (cleaned.endsWith("/api")) {
    cleaned = cleaned.substring(0, cleaned.length - 4);
  }
  return cleaned;
};

const BACKEND_URL = getBackendUrl();

export default function RegisterScreen() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("error");
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalOtp, setModalOtp] = useState("");

  const sendOtpEmail = async (email: string, otp: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp }),
      });
      return await res.json();
    } catch (e) {
      console.log("OTP send error:", e);
      return { success: false, message: "Backend offline" };
    }
  };

  const handleRegister = async () => {
    setMessage("");

    if (!username.trim() || !email.trim() || !password || !confirmPassword) {
      setMessage("⚠️ Please fill all fields");
      setMessageType("error");
      return;
    }

    if (username.trim().length < 3) {
      setMessage("❌ Username must be at least 3 characters");
      setMessageType("error");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setMessage("❌ Please enter a valid email address");
      setMessageType("error");
      return;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
    if (!passwordRegex.test(password)) {
      setMessage(
        "❌ Password must have:\n• 8+ characters\n• 1 uppercase letter\n• 1 number\n• 1 special character"
      );
      setMessageType("error");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("❌ Passwords do not match");
      setMessageType("error");
      return;
    }

    setLoading(true);

    try {
      // Clear any leftover verified state before starting new registration verification
      await AsyncStorage.removeItem("is_otp_verified");

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store OTP
      await AsyncStorage.setItem(
        "pendingOTP",
        JSON.stringify({ code: otp, email: email.trim(), expires: Date.now() + 5 * 60 * 1000 })
      );

      // Store pending registration data
      await AsyncStorage.setItem(
        "pendingRegister",
        JSON.stringify({ usr: username.trim(), em: email.trim(), pw: password })
      );

      // Send real OTP email via Python FastAPI backend
      const emailRes = await sendOtpEmail(email.trim(), otp);

      setMessage("✅ OTP sent! Check your inbox.");
      setMessageType("success");
      setModalOtp(otp);
      setModalVisible(true);
      setLoading(false);
    } catch (error: any) {
      setMessage("❌ Registration failed. Try again.");
      setMessageType("error");
      setLoading(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Success Modal */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconCircle}>
                <Ionicons name="shield-checkmark" size={32} color="#38BDF8" />
              </View>
              <Text style={styles.modalTitle}>🔐 OTP Sent Successfully</Text>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalText}>
                An OTP has been sent to your registered email address.
              </Text>
              
              <View style={styles.otpDisplayContainer}>
                <Text style={styles.otpDisplayLabel}>Your OTP is:</Text>
                <Text testID="otp-display-value" accessibilityLabel="otp-display-value" style={styles.otpDisplayValue}>{modalOtp}</Text>
              </View>
            </View>

            <TouchableOpacity
              testID="otp-modal-ok-button"
              accessibilityLabel="otp-modal-ok-button"
              onPress={() => {
                setModalVisible(false);
                router.replace({
                  pathname: "/otp",
                  params: { email: email.trim(), isRegister: "true" },
                });
              }}
              style={styles.modalOkBtn}
            >
              <Text style={styles.modalOkBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Back Button */}
      <TouchableOpacity onPress={() => router.replace("/login")} style={styles.backBtn}>
        <Ionicons name="arrow-back-outline" size={22} color="white" />
      </TouchableOpacity>

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoCircle}>
          <Text style={{ fontSize: 36 }}>🚀</Text>
        </View>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join TripSync & Travel Smarter</Text>
      </View>

      {/* Message */}
      {message ? (
        <View
          style={[
            styles.msgBox,
            messageType === "error" ? styles.msgError : messageType === "success" ? styles.msgSuccess : styles.msgInfo,
          ]}
        >
          <Text style={styles.msgText}>{message}</Text>
        </View>
      ) : null}

      {/* Username */}
      <View style={styles.inputWrapper}>
        <Ionicons name="person-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          testID="username-input"
          accessibilityLabel="username-input"
          placeholder="Username"
          placeholderTextColor="#94A3B8"
          value={username}
          onChangeText={setUsername}
          style={styles.input}
          autoCapitalize="none"
        />
      </View>

      {/* Email */}
      <View style={styles.inputWrapper}>
        <Ionicons name="mail-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          testID="email-input"
          accessibilityLabel="email-input"
          placeholder="Email Address"
          placeholderTextColor="#94A3B8"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      {/* Password */}
      <View style={styles.inputWrapper}>
        <Ionicons name="lock-closed-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          testID="password-input"
          accessibilityLabel="password-input"
          placeholder="Password"
          placeholderTextColor="#94A3B8"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          style={[styles.input, { flex: 1 }]}
        />
        <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={{ paddingRight: 15 }}>
          <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      {/* Confirm Password */}
      <View style={styles.inputWrapper}>
        <Ionicons name="shield-checkmark-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          placeholder="Confirm Password"
          placeholderTextColor="#94A3B8"
          secureTextEntry={!showConfirm}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={[styles.input, { flex: 1 }]}
        />
        <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} style={{ paddingRight: 15 }}>
          <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={20} color="#38BDF8" />
        </TouchableOpacity>
      </View>

      {/* Password Requirements */}
      <View style={styles.requirementsBox}>
        <Text style={styles.reqHeader}>Password Requirements:</Text>
        {["8+ characters", "1 uppercase letter", "1 number", "1 special character (@$!%*?&)"].map(
          (req, i) => (
            <View key={i} style={styles.reqRow}>
              <Ionicons
                name={password.match(
                  i === 0 ? /.{8,}/ : i === 1 ? /[A-Z]/ : i === 2 ? /\d/ : /[@$!%*?&]/
                ) ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={password.match(
                  i === 0 ? /.{8,}/ : i === 1 ? /[A-Z]/ : i === 2 ? /\d/ : /[@$!%*?&]/
                ) ? "#22C55E" : "#475569"}
              />
              <Text style={[styles.reqText, {
                color: password.match(
                  i === 0 ? /.{8,}/ : i === 1 ? /[A-Z]/ : i === 2 ? /\d/ : /[@$!%*?&]/
                ) ? "#22C55E" : "#94A3B8",
              }]}>{req}</Text>
            </View>
          )
        )}
      </View>

      {/* Register Button */}
      <TouchableOpacity
        testID="register-button"
        accessibilityLabel="register-button"
        onPress={handleRegister}
        style={[styles.registerBtn, loading && { opacity: 0.7 }]}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.registerBtnText}>Send OTP & Register 🚀</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity testID="login-link" accessibilityLabel="login-link" onPress={() => router.replace("/login")} style={styles.loginLink}>
        <Text style={styles.loginLinkText}>
          Already have an account?{" "}
          <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>Login</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#0F172A",
    padding: 24,
    paddingBottom: 50,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#1E293B",
    borderRadius: 24,
    width: "100%",
    maxWidth: 340,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(56, 189, 248, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  modalBody: {
    width: "100%",
    alignItems: "center",
    marginBottom: 24,
  },
  modalText: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  otpDisplayContainer: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
    width: "100%",
  },
  otpDisplayLabel: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  otpDisplayValue: {
    color: "#38BDF8",
    fontSize: 28,
    fontWeight: "bold",
    letterSpacing: 4,
  },
  modalOkBtn: {
    backgroundColor: "#38BDF8",
    paddingVertical: 14,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  modalOkBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
  backBtn: {
    marginTop: 55,
    marginBottom: 10,
    backgroundColor: "#1E293B",
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 30,
    marginTop: 10,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(56,189,248,0.12)",
    borderWidth: 2,
    borderColor: "rgba(56,189,248,0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { color: "white", fontSize: 32, fontWeight: "bold" },
  subtitle: { color: "#94A3B8", fontSize: 15, marginTop: 6 },
  msgBox: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
  },
  msgError: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.4)" },
  msgSuccess: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.4)" },
  msgInfo: { backgroundColor: "rgba(56,189,248,0.1)", borderColor: "rgba(56,189,248,0.4)" },
  msgText: { color: "white", textAlign: "center", fontWeight: "600", lineHeight: 20 },
  inputWrapper: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: {
    flex: 1,
    color: "white",
    paddingVertical: 16,
    fontSize: 15,
    paddingRight: 15,
  },
  requirementsBox: {
    backgroundColor: "#1E293B",
    borderRadius: 14,
    padding: 16,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: "#334155",
  },
  reqHeader: { color: "#94A3B8", fontSize: 12, fontWeight: "700", marginBottom: 10, letterSpacing: 0.5 },
  reqRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  reqText: { fontSize: 13 },
  registerBtn: {
    backgroundColor: "#38BDF8",
    padding: 18,
    borderRadius: 16,
    marginBottom: 16,
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  registerBtnText: { color: "white", fontWeight: "bold", fontSize: 17 },
  loginLink: { alignItems: "center", paddingVertical: 8 },
  loginLinkText: { color: "#94A3B8", fontSize: 15 },
});