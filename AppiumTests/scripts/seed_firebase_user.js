const { initializeApp } = require("firebase/app");
const { getAuth, createUserWithEmailAndPassword } = require("firebase/auth");

const firebaseConfig = {
  apiKey: "AIzaSyDpBTv3re8BuZR-i25ZeuKsUykN1DYcxNo",
  authDomain: "tripsync-8e63e.firebaseapp.com",
  projectId: "tripsync-8e63e",
  storageBucket: "tripsync-8e63e.firebasestorage.app",
  messagingSenderId: "167694267883",
  appId: "1:167694267883:web:61bd7d4f75be2ad2a915ae",
  measurementId: "G-QN6RB14ZGF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

async function seed() {
  const email = "testuser@tripsync.dev";
  const password = "Test@123456";
  console.log(`[seed] Attempting to seed Firebase Auth user: ${email}...`);
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    console.log(`[seed] ✅ User registered successfully.`);
  } catch (error) {
    if (error.code === "auth/email-already-in-use") {
      console.log(`[seed] ✅ User already exists in Firebase Auth.`);
    } else {
      console.error(`[seed] ❌ Error seeding user:`, error.message);
    }
  }
}

seed().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
