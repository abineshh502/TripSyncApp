import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import app, { auth } from "../firebaseConfig";

export default function EditProfileScreen() {
  const db = getFirestore(app);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [profileImage, setProfileImage] = useState(
    "https://cdn-icons-png.flaticon.com/512/3135/3135715.png"
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const data = snap.data();
          setName(data.username || data.name || user.displayName || "");
          setBio(data.bio || "");
          if (data.profileImage) setProfileImage(data.profileImage);
        } else {
          setName(user.displayName || "");
        }
      } catch (e) {
        console.log("Load profile error:", e);
      }
    };
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      setProfileImage(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Required", "Please enter a valid display name.");
      return;
    }

    const user = auth.currentUser;
    if (!user) return;

    setLoading(true);
    try {
      // 1. Update Firebase Auth Profile details
      await updateProfile(user, {
        displayName: name.trim(),
        photoURL: profileImage,
      });

      // 2. Update Firestore user document
      await setDoc(
        doc(db, "users", user.uid),
        {
          username: name.trim(),
          bio: bio.trim(),
          profileImage: profileImage,
        },
        { merge: true }
      );

      Alert.alert("Success", "Profile updated successfully!");
      router.back();
    } catch (e) {
      console.log("Profile update error:", e);
      Alert.alert("Error", "Could not save profile changes.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Edit Profile ✏️</Text>

      <TouchableOpacity onPress={pickImage} style={styles.avatarWrapper}>
        <Image
          source={{ uri: profileImage }}
          style={styles.avatar}
        />
        <View style={styles.editBadge}>
          <Text style={styles.badgeText}>Edit</Text>
        </View>
      </TouchableOpacity>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Enter Name"
        placeholderTextColor="#94A3B8"
        style={styles.input}
      />

      <TextInput
        value={bio}
        onChangeText={setBio}
        placeholder="Enter Bio"
        placeholderTextColor="#94A3B8"
        multiline
        style={styles.bioInput}
      />

      <TouchableOpacity
        onPress={handleSave}
        disabled={loading}
        style={styles.saveBtn}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.saveText}>Save Profile</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 20,
    justifyContent: "center",
  },
  title: {
    color: "white",
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 30,
  },
  avatarWrapper: {
    alignItems: "center",
    marginBottom: 25,
    position: "relative",
    alignSelf: "center",
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: "#38BDF8",
  },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 4,
    backgroundColor: "#38BDF8",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    color: "white",
    fontSize: 11,
    fontWeight: "bold",
  },
  input: {
    backgroundColor: "#1E293B",
    color: "white",
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  bioInput: {
    backgroundColor: "#1E293B",
    color: "white",
    padding: 15,
    borderRadius: 12,
    marginBottom: 30,
    height: 100,
    textAlignVertical: "top",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  saveBtn: {
    backgroundColor: "#38BDF8",
    padding: 16,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  saveText: {
    color: "white",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
});