import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, authVerification } from "../firebaseConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import * as Linking from "expo-linking";

const extractRouteId = (url: string) => {
  try {
    const match = url.match(/routeId=([^&]+)/);
    if (match && match[1]) return match[1];
    const pathMatch = url.match(/\/routes\/([^?/]+)/);
    if (pathMatch && pathMatch[1]) return pathMatch[1];
  } catch (e) {
    console.log("Error parsing deep link:", e);
  }
  return null;
};

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const [isInitializing, setIsInitializing] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const [pendingRouteId, setPendingRouteId] = useState<string | null>(null);

  // CI / E2E mode: skip Firebase auth and go straight to login
  const isE2EMode = process.env.EXPO_PUBLIC_E2E_MODE === 'true';

  useEffect(() => {
    if (isE2EMode) {
      // In E2E test mode, bypass Firebase and navigate directly to login
      setIsInitializing(false);
      return;
    }

    // Check initial URL
    Linking.getInitialURL().then((url) => {
      if (url) {
        const rid = extractRouteId(url);
        if (rid) {
          setPendingRouteId(rid);
        }
      }
    });

    // Listen to URL events
    const handleDeepLink = (event: { url: string }) => {
      const rid = extractRouteId(event.url);
      if (rid) {
        setPendingRouteId(rid);
      }
    };

    const sub = Linking.addEventListener("url", handleDeepLink);

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const verified = await AsyncStorage.getItem("is_otp_verified");
        if (auth.currentUser?.uid === u.uid) {
          setOtpVerified(verified === "true");
          setUser(u);
        }
      } else {
        setUser(null);
        setOtpVerified(false);
      }
      setIsInitializing(false);
    });

    return () => {
      sub.remove();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (isInitializing) return;
    if (isE2EMode) {
      // In E2E mode, always navigate to login
      router.replace("/login");
      return;
    }

    const evaluateRoute = async () => {
      const verified = await AsyncStorage.getItem("is_otp_verified");
      const isVerified = verified === "true";
      
      if (isVerified !== otpVerified) {
        setOtpVerified(isVerified);
      }

      const seg0 = segments[0] as string;
      const isPublicRoute =
        seg0 === "login" ||
        seg0 === "register" ||
        seg0 === "otp" ||
        seg0 === "routes";

      if (pendingRouteId) {
        const rid = pendingRouteId;
        setPendingRouteId(null);
        router.push(`/routes/${rid}`);
        return;
      }

      if (!user) {
        // If not logged in, redirect to login if they try to access protected screens
        if (!isPublicRoute) {
          router.replace("/login");
        }
      } else {
        // User is logged in
        if (!isVerified) {
          // If logged in but OTP is not verified, FORCE to OTP screen
          // Skip if credentials verification is currently in progress
          if (seg0 !== "otp" && !authVerification.isVerifying) {
            router.replace({
              pathname: "/otp",
              params: { email: user.email || "", isLogin: "true" },
            });
          }
        } else {
          // Logged in and verified, prevent returning to auth screens
          const inAuthGroup =
            seg0 === "login" ||
            seg0 === "register" ||
            seg0 === "otp";
          if (inAuthGroup) {
            router.replace("/(tabs)");
          }
        }
      }
    };

    evaluateRoute();
  }, [user, segments, isInitializing, otpVerified]);

  const seg0 = segments[0] as string;
  const isPublicRoute =
    seg0 === "login" ||
    seg0 === "register" ||
    seg0 === "otp" ||
    seg0 === "routes";

  const isProtectedAndUnverified = user && !otpVerified && !isPublicRoute && seg0;
  const isLoggedOutAndProtected = !user && !isPublicRoute && seg0;

  if (isInitializing) {
    return (
      <View testID="app-loading-spinner" style={{ flex: 1, backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#38BDF8" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            animationDuration: 250,
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="otp" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="ai-assistant" />
          <Stack.Screen name="ai-trip" />
          <Stack.Screen name="create-trip" />
          <Stack.Screen name="my-trips" />
          <Stack.Screen name="trip-details" />
          <Stack.Screen name="edit-trip" />
          <Stack.Screen name="favorites" />
          <Stack.Screen name="visited" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="group-details" />
          <Stack.Screen name="group-chat" />
          <Stack.Screen name="maps" />
          <Stack.Screen name="routes/[routeId]" />
        </Stack>

        {(isProtectedAndUnverified || isLoggedOutAndProtected) && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0F172A", justifyContent: "center", alignItems: "center", zIndex: 9999 }]}>
            <ActivityIndicator size="large" color="#38BDF8" />
          </View>
        )}
      </View>
    </>
  );
}