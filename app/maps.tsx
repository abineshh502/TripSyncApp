import {
  View,
  Text,
} from "react-native";

import MapView, {
  Marker,
} from "react-native-maps";

export default function MapsScreen() {

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0F172A",
      }}
    >

      <Text
        style={{
          color: "white",
          fontSize: 28,
          fontWeight: "bold",
          marginTop: 60,
          marginLeft: 20,
          position: "absolute",
          zIndex: 1,
        }}
      >
        TripSync Maps 🗺️
      </Text>

      <MapView
        style={{
          width: "100%",
          height: "100%",
        }}
        initialRegion={{
          latitude: 13.0827,
          longitude: 80.2707,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >

        <Marker
          coordinate={{
            latitude: 13.0827,
            longitude: 80.2707,
          }}
          title="Chennai"
          description="Welcome to Chennai"
        />

      </MapView>

    </View>
  );
}