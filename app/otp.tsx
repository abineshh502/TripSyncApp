import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { auth } from "../firebaseConfig";
import app from "../firebaseConfig";
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

export default function OtpScreen() {
  const { email, isLogin, isRegister } = useLocalSearchParams<{
    email: string;
    isLogin?: string;
    isRegister?: string;
  }>();

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [timer, setTimer] = useState(120);
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const successAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const db = getFirestore(app);

  // Block hardware back button — OTP is mandatory
  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      Alert.alert(
        "OTP Required 🔐",
        "You must verify your OTP before accessing the app.",
        [{ text: "OK" }]
      );
      return true; // Prevents back navigation
    });
    return () => backHandler.remove();
  }, []);

  useEffect(() => {
    inputs.current[0]?.focus();
    const interval = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) { clearInterval(interval); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (text: string, index: number) => {
    if (!/^\d*$/.test(text)) return;
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);
    if (text && index < 5) inputs.current[index + 1]?.focus();
    if (!text && index > 0) inputs.current[index - 1]?.focus();
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !otp[index] && index > 0) {
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
      inputs.current[index - 1]?.focus();
    }
  };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const triggerSuccess = () => {
    Animated.spring(successAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 40,
      friction: 5,
    }).start();
  };

  const finalizeSession = async () => {
    // Mark OTP as verified in AsyncStorage
    await AsyncStorage.setItem("is_otp_verified", "true");
  };

  const handleVerify = async () => {
    const enteredCode = otp.join("");
    if (enteredCode.length !== 6) {
      setMessage("⚠️ Enter all 6 digits");
      setMessageType("error");
      triggerShake();
      return;
    }
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem("pendingOTP");
      if (!stored) {
        setMessage("❌ OTP expired. Please resend.");
        setMessageType("error");
        triggerShake();
        setLoading(false);
        return;
      }
      const { code, expires } = JSON.parse(stored);
      if (Date.now() > expires) {
        setMessage("❌ OTP expired. Tap resend below.");
        setMessageType("error");
        triggerShake();
        await AsyncStorage.removeItem("pendingOTP");
        setLoading(false);
        return;
      }
      if (enteredCode !== code) {
        setMessage("❌ Invalid OTP. Try again.");
        setMessageType("error");
        triggerShake();
        setOtp(["", "", "", "", "", ""]);
        inputs.current[0]?.focus();
        setLoading(false);
        return;
      }

      // ✅ Valid OTP!
      await AsyncStorage.removeItem("pendingOTP");
      setMessage("✅ Verified Successfully!");
      setMessageType("success");
      triggerSuccess();

      if (isRegister === "true") {
        // --- REGISTER FLOW: Create the Firebase account now ---
        try {
          const pending = await AsyncStorage.getItem("pendingRegister");
          if (pending) {
            const { usr, em, pw } = JSON.parse(pending);
            // 1. Mark session as verified FIRST to avoid race condition in layout guard
            await finalizeSession();
            // 2. Create the user credential (which automatically logs the user in)
            const userCredential = await createUserWithEmailAndPassword(auth, em, pw);
            await setDoc(doc(db, "users", userCredential.user.uid), {
              username: usr,
              email: em,
              bio: "Smart Traveler 🚀",
              createdAt: new Date(),
              userId: userCredential.user.uid,
            });
            await AsyncStorage.removeItem("pendingRegister");
            setTimeout(() => router.replace("/(tabs)"), 300);
          } else {
            setMessage("❌ Registration data lost. Please register again.");
            setMessageType("error");
            setTimeout(() => router.replace("/register"), 2000);
          }
        } catch (e: any) {
          console.log("Account creation error:", e);
          // Rollback verification flag if it failed
          await AsyncStorage.removeItem("is_otp_verified");
          if (e.code === "auth/email-already-in-use") {
            setMessage("❌ Email already registered. Please login.");
            setMessageType("error");
            setTimeout(() => router.replace("/login"), 2000);
          } else {
            setMessage("❌ Account creation failed. Try again.");
            setMessageType("error");
          }
        }
      } else if (isLogin === "true") {
        // --- LOGIN FLOW: Complete the Firebase sign-in now ---
        try {
          const pending = await AsyncStorage.getItem("pendingLoginCredentials");
          if (pending) {
            const { em, pw } = JSON.parse(pending);
            // 1. Mark session as verified FIRST to avoid race condition in layout guard
            await finalizeSession();
            // 2. Sign in the user
            await signInWithEmailAndPassword(auth, em, pw);
            await AsyncStorage.removeItem("pendingLoginCredentials");
            setTimeout(() => router.replace("/(tabs)"), 300);
          } else {
            setMessage("❌ Session expired. Please login again.");
            setMessageType("error");
            setTimeout(() => router.replace("/login"), 2000);
          }
        } catch (e: any) {
          console.log("Login finalization error:", e);
          // Rollback verification flag if it failed
          await AsyncStorage.removeItem("is_otp_verified");
          setMessage("❌ Login failed. Please try again.");
          setMessageType("error");
        }
      }
    } catch (e) {
      setMessage("❌ Verification error. Try again.");
      setMessageType("error");
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (timer > 0) return;
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000;

    await AsyncStorage.setItem(
      "pendingOTP",
      JSON.stringify({ code: newOtp, email, expires })
    );

    // Try to send via backend API
    try {
      await fetch(`${BACKEND_URL}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: newOtp }),
      });
    } catch (e) {
      console.log("Backend OTP resend failed, OTP stored locally:", newOtp);
    }

    setTimer(120);
    setOtp(["", "", "", "", "", ""]);
    inputs.current[0]?.focus();
    setMessage("");
    Alert.alert(
      "OTP Resent 📧",
      `A new verification code has been sent to ${email}.\n\n(Valid for 5 minutes)`
    );
  };

  const handleCancelAndLogout = async () => {
    setLoading(true);
    try {
      await auth.signOut();
      await AsyncStorage.removeItem("pendingLoginCredentials");
      await AsyncStorage.removeItem("pendingRegister");
      await AsyncStorage.removeItem("pendingOTP");
      await AsyncStorage.removeItem("is_otp_verified");
      if (isRegister === "true") {
        router.replace("/register");
      } else {
        router.replace("/login");
      }
    } catch (e) {
      console.log("Cancel error:", e);
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Success Animation */}
      <Animated.View
        style={[styles.successIcon, {
          opacity: successAnim,
          transform: [{ scale: successAnim }],
        }]}
      >
        <Text style={{ fontSize: 50 }}>✅</Text>
      </Animated.View>

      {/* Header */}
      <View style={styles.shield}>
        <Ionicons name="shield-checkmark" size={36} color="#38BDF8" />
      </View>
      <Text style={styles.title}>OTP Verification 🔐</Text>
      <Text style={styles.subtitle}>
        Enter the 6-digit code{"\n"}
        sent to <Text style={{ color: "#38BDF8", fontWeight: "bold" }}>{email || "your email"}</Text>
      </Text>

      {/* Message */}
      {message ? (
        <View style={[styles.msgBox, messageType === "error" ? styles.msgError : styles.msgSuccess]}>
          <Text style={styles.msgText}>{message}</Text>
        </View>
      ) : null}

      {/* OTP Boxes */}
      <Animated.View style={[styles.otpRow, { transform: [{ translateX: shakeAnim }] }]}>
        {otp.map((digit, i) => (
          <TextInput
            key={i}
            ref={(r) => { inputs.current[i] = r; }}
            value={digit}
            onChangeText={(t) => handleChange(t, i)}
            onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
            keyboardType="number-pad"
            maxLength={1}
            style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
            selectionColor="#38BDF8"
            testID={`otp-input-${i}`}
          />
        ))}
      </Animated.View>

      {/* Timer */}
      <View style={styles.timerRow}>
        <Ionicons name="time-outline" size={16} color="#94A3B8" />
        <Text style={styles.timerText}>
          {timer > 0 ? `Code expires in ${formatTime(timer)}` : "Code expired"}
        </Text>
      </View>

      {/* Verify Button */}
      <TouchableOpacity
        testID="verify-button"
        onPress={handleVerify}
        style={[styles.verifyBtn, loading && { opacity: 0.7 }]}
        disabled={loading}
      >
        <Text style={styles.verifyBtnText}>
          {loading ? "Verifying..." : isRegister === "true" ? "Verify & Create Account ✓" : "Verify & Login ✓"}
        </Text>
      </TouchableOpacity>

      {/* Resend */}
      <TouchableOpacity
        onPress={handleResend}
        disabled={timer > 0}
        style={[styles.resendBtn, timer > 0 && { opacity: 0.4 }]}
      >
        <Ionicons name="refresh-outline" size={16} color="#38BDF8" style={{ marginRight: 6 }} />
        <Text style={styles.resendText}>
          {timer > 0 ? `Resend in ${formatTime(timer)}` : "Resend OTP"}
        </Text>
      </TouchableOpacity>

      {/* Cancel / Go Back */}
      <TouchableOpacity
        testID="cancel-button"
        onPress={handleCancelAndLogout}
        style={styles.cancelBtn}
      >
        <Ionicons name="arrow-back-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
        <Text style={styles.cancelText}>Cancel & Go Back</Text>
      </TouchableOpacity>

      <View style={styles.securityNote}>
        <Ionicons name="lock-closed-outline" size={14} color="#475569" />
        <Text style={styles.noteText}>
          Your account is protected. OTP is required to access TripSync.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  successIcon: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
  },
  shield: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(56,189,248,0.12)",
    borderWidth: 2,
    borderColor: "rgba(56,189,248,0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    color: "white",
    fontSize: 30,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    color: "#94A3B8",
    textAlign: "center",
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 25,
  },
  msgBox: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    width: "100%",
    borderWidth: 1,
  },
  msgError: { backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.4)" },
  msgSuccess: { backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.4)" },
  msgText: { color: "white", textAlign: "center", fontWeight: "600" },
  otpRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  otpBox: {
    width: 50,
    height: 60,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    color: "white",
    fontSize: 26,
    fontWeight: "bold",
    textAlign: "center",
    borderWidth: 1.5,
    borderColor: "#334155",
  },
  otpBoxFilled: {
    borderColor: "#38BDF8",
    backgroundColor: "rgba(56,189,248,0.08)",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 28,
  },
  timerText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "500",
  },
  verifyBtn: {
    backgroundColor: "#38BDF8",
    padding: 18,
    borderRadius: 16,
    width: "100%",
    marginBottom: 14,
    alignItems: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  verifyBtnText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 17,
  },
  resendBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 20,
  },
  resendText: {
    color: "#38BDF8",
    fontWeight: "600",
    fontSize: 15,
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
  },
  noteText: {
    color: "#475569",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    flex: 1,
  },
  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 20,
  },
  cancelText: {
    color: "#EF4444",
    fontWeight: "600",
    fontSize: 15,
  },
});