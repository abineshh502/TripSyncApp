import { router } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from "react-native";

import { useEffect, useState } from "react";

import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  where,
} from "firebase/firestore";

import app, { auth } from "../firebaseConfig";

export default function MyTripsScreen() {

  const db = getFirestore(app);

  const [trips, setTrips] =
    useState<any[]>([]);

  useEffect(() => {

    fetchTrips();

  }, []);

  const fetchTrips = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      // Filter trips by userId — user data isolation
      const q = query(
        collection(db, "trips"),
        where("userId", "==", currentUser.uid)
      );

      const querySnapshot = await getDocs(q);
      const tempTrips: any[] = [];

      querySnapshot.forEach((doc) => {
        tempTrips.push({ id: doc.id, ...doc.data() });
      });

      tempTrips.sort((a, b) => {
        const tA = a.createdAt?.seconds || a.createdAt || 0;
        const tB = b.createdAt?.seconds || b.createdAt || 0;
        return tB - tA;
      });

      setTrips(tempTrips);
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "#0F172A",
        padding: 20,
      }}
    >

      <Text
        style={{
          color: "white",
          fontSize: 32,
          fontWeight: "bold",
          marginTop: 50,
          marginBottom: 30,
        }}
      >
        My Trips ✈️
      </Text>

      {trips.map((trip, index) => (

        <TouchableOpacity
        onPress={() => {

        router.push({
            pathname: "/trip-details",
            params: {
            id: trip.id,
            tripName: trip.tripName,
            destination: trip.destination,
            budget: trip.budget,
            startDate: trip.startDate,
            endDate: trip.endDate,
            },
        });

        }}
          key={index}
          style={{
            backgroundColor: "#1E293B",
            padding: 20,
            borderRadius: 20,
            marginBottom: 20,
          }}
        >

          <Text
            style={{
              color: "white",
              fontSize: 22,
              fontWeight: "bold",
            }}
          >
            {trip.tripName}
          </Text>

          <Text
            style={{
              color: "#94A3B8",
              marginTop: 10,
            }}
          >
            📍 {trip.destination}
          </Text>

          <Text
            style={{
              color: "#38BDF8",
              marginTop: 10,
              fontWeight: "bold",
            }}
          >
            ₹ {trip.budget}
          </Text>

          <Text
            style={{
              color: "white",
              marginTop: 10,
            }}
          >
            🗓 {trip.startDate} - {trip.endDate}
          </Text>

        </TouchableOpacity>

      ))}

    </ScrollView>
  );
}