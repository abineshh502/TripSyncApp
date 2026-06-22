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
import { useEffect, useState, useRef } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import { auth, authVerification } from "../firebaseConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
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

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [savedAccounts, setSavedAccounts] = useState<{ email: string; password: string }[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalOtp, setModalOtp] = useState("");

  useEffect(() => {
    loadSavedAccounts();
  }, []);

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

  const loadSavedAccounts = async () => {
    try {
      const stored = await AsyncStorage.getItem("savedAccounts");
      if (stored) setSavedAccounts(JSON.parse(stored));
    } catch (e) {
      console.log("Load accounts error:", e);
    }
  };



  const handleLogin = async () => {
    setMessage("");
    if (!email.trim() || !password.trim()) {
      setMessage("⚠️ Please fill all fields");
      setMessageType("error");
      return;
    }
    setLoading(true);
    try {
      // Clear any leftover verified state before starting new login verification
      await AsyncStorage.removeItem("is_otp_verified");
      
      // Set the verification flag in progress
      authVerification.isVerifying = true;
      
      // 1. Verify credentials by signing in
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);

      // 2. Immediately sign out so there is no active session on Firebase until OTP is verified
      await auth.signOut();

      // Reset the flag
      authVerification.isVerifying = false;

      // 3. Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await AsyncStorage.setItem(
        "pendingOTP",
        JSON.stringify({ code: otp, email: email.trim(), expires: Date.now() + 5 * 60 * 1000 })
      );

      // 4. Save credentials temporarily for sign-in after successful OTP
      await AsyncStorage.setItem(
        "pendingLoginCredentials",
        JSON.stringify({ em: email.trim(), pw: password })
      );

      // 5. Send real OTP email via Python FastAPI backend
      const emailRes = await sendOtpEmail(email.trim(), otp);

      // 6. Save account credentials
      const updatedAccounts = [
        { email: email.trim(), password },
        ...savedAccounts.filter((a) => a.email !== email.trim()),
      ].slice(0, 5);
      setSavedAccounts(updatedAccounts);
      await AsyncStorage.setItem("savedAccounts", JSON.stringify(updatedAccounts));

      setModalOtp(otp);
      setModalVisible(true);
      setLoading(false);
    } catch (error: any) {
      // Reset the flag in case of errors
      authVerification.isVerifying = false;

      if (error.code === "auth/invalid-email") setMessage("❌ Invalid Email");
      else if (error.code === "auth/invalid-credential") setMessage("❌ Incorrect Email or Password");
      else if (error.code === "auth/too-many-requests") setMessage("❌ Too many attempts. Try later.");
      else setMessage("❌ Login Failed. Check credentials.");
      setMessageType("error");
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    if (!email.trim()) {
      setMessage("⚠️ Enter your email first");
      setMessageType("error");
      return;
    }
    setMessage("📩 Password reset instructions sent to your email.");
    setMessageType("info");
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
                <Text testID="otp-display-value" style={styles.otpDisplayValue}>{modalOtp}</Text>
              </View>
            </View>

            <TouchableOpacity
              testID="otp-modal-ok-button"
              onPress={() => {
                setModalVisible(false);
                router.replace({ pathname: "/otp", params: { email: email.trim(), isLogin: "true" } });
              }}
              style={styles.modalOkBtn}
            >
              <Text style={styles.modalOkBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Logo Section */}
      <View style={styles.logoSection}>
        <View style={styles.logoCircle}>
          <Text style={{ fontSize: 40 }}>✈️</Text>
        </View>
        <Text style={styles.appTitle}>TripSync</Text>
        <Text style={styles.appSubtitle}>Smart AI Travel Companion</Text>
      </View>

      {/* Message Box */}
      {message ? (
        <View
          style={[
            styles.msgBox,
            messageType === "error"
              ? styles.msgError
              : messageType === "success"
              ? styles.msgSuccess
              : styles.msgInfo,
          ]}
        >
          <Text style={styles.msgText}>{message}</Text>
        </View>
      ) : null}

      {/* Email */}
      <View style={styles.inputWrapper}>
        <Ionicons name="mail-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          testID="email-input"
          placeholder="Email Address"
          placeholderTextColor="#94A3B8"
          value={email}
          onChangeText={setEmail}
          onFocus={() => setShowSaved(true)}
          onBlur={() => setTimeout(() => setShowSaved(false), 200)}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />
        {email.length > 0 && (
          <TouchableOpacity onPress={() => setEmail("")} style={{ paddingRight: 12 }}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Saved Accounts Dropdown */}
      {showSaved && savedAccounts.length > 0 && (
        <View style={styles.savedDropdown}>
          <Text style={styles.savedHeader}>Saved Accounts</Text>
          {savedAccounts.map((acc, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                setEmail(acc.email);
                setPassword(acc.password);
                setShowSaved(false);
              }}
              style={[styles.savedItem, i < savedAccounts.length - 1 && styles.savedItemBorder]}
            >
              <Ionicons name="person-circle-outline" size={22} color="#38BDF8" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.savedEmail}>{acc.email}</Text>
                <Text style={styles.savedHint}>Tap to auto-fill</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Password */}
      <View style={styles.inputWrapper}>
        <Ionicons name="lock-closed-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
        <TextInput
          testID="password-input"
          placeholder="Password"
          placeholderTextColor="#94A3B8"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          style={[styles.input, { flex: 1 }]}
        />
        <TouchableOpacity
          onPress={() => setShowPassword(!showPassword)}
          style={{ paddingRight: 15 }}
        >
          <Ionicons
            name={showPassword ? "eye-off-outline" : "eye-outline"}
            size={20}
            color="#38BDF8"
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={handleForgotPassword} style={styles.forgotBtn}>
        <Text style={styles.forgotText}>Forgot Password?</Text>
      </TouchableOpacity>

      <TouchableOpacity
        testID="login-button"
        onPress={handleLogin}
        style={[styles.loginBtn, loading && { opacity: 0.8 }]}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.loginBtnText}>Login & Send OTP 🔐</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        testID="register-link"
        onPress={() => router.replace("/register")}
        style={styles.registerLink}
      >
        <Text style={styles.registerLinkText}>
          New User?{" "}
          <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>Create Account</Text>
        </Text>
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Premium AI Travel</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.featuresRow}>
        {["🗺️ Maps", "🤖 AI Planner", "👥 Groups", "🌦️ Live Weather"].map((f, i) => (
          <View key={i} testID={`feature-badge-${i}`} style={styles.featureBadge}>
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#0F172A",
    padding: 24,
    justifyContent: "center",
    paddingBottom: 40,
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
  logoSection: {
    alignItems: "center",
    marginBottom: 40,
    marginTop: 20,
  },
  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(56,189,248,0.12)",
    borderWidth: 2,
    borderColor: "rgba(56,189,248,0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  appTitle: {
    color: "white",
    fontSize: 40,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: "#94A3B8",
    fontSize: 15,
    marginTop: 6,
  },
  msgBox: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
  },
  msgError: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderColor: "rgba(239,68,68,0.4)",
  },
  msgSuccess: {
    backgroundColor: "rgba(34,197,94,0.1)",
    borderColor: "rgba(34,197,94,0.4)",
  },
  msgInfo: {
    backgroundColor: "rgba(56,189,248,0.1)",
    borderColor: "rgba(56,189,248,0.4)",
  },
  msgText: {
    color: "white",
    textAlign: "center",
    fontWeight: "600",
    fontSize: 14,
  },
  inputWrapper: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputIcon: {
    paddingLeft: 16,
    paddingRight: 8,
  },
  input: {
    flex: 1,
    color: "white",
    paddingVertical: 16,
    fontSize: 15,
  },
  savedDropdown: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#334155",
    overflow: "hidden",
  },
  savedHeader: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    padding: 12,
    paddingBottom: 8,
    textTransform: "uppercase",
  },
  savedItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  savedItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  savedEmail: {
    color: "white",
    fontSize: 14,
    fontWeight: "500",
  },
  savedHint: {
    color: "#94A3B8",
    fontSize: 11,
    marginTop: 2,
  },
  forgotBtn: {
    alignSelf: "flex-end",
    marginBottom: 24,
    paddingVertical: 4,
  },
  forgotText: {
    color: "#38BDF8",
    fontWeight: "600",
    fontSize: 14,
  },
  loginBtn: {
    backgroundColor: "#38BDF8",
    padding: 18,
    borderRadius: 16,
    marginBottom: 18,
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  loginBtnText: {
    color: "white",
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 17,
  },
  registerLink: {
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 30,
  },
  registerLinkText: {
    color: "#94A3B8",
    fontSize: 15,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#1E293B",
  },
  dividerText: {
    color: "#475569",
    fontSize: 12,
    marginHorizontal: 12,
    fontWeight: "600",
  },
  featuresRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  featureBadge: {
    backgroundColor: "#1E293B",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  featureText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
  },
});