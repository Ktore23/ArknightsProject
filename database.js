// Import Firebase SDK
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

// Cấu hình Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAlqdZJmSvvyhTu1x_4ymhMqFvFxPhLOKM",
    authDomain: "arknights-2bf18.firebaseapp.com",
    projectId: "arknights-2bf18",
    storageBucket: "arknights-2bf18.firebasestorage.app",
    messagingSenderId: "702475861792",
    appId: "1:702475861792:web:59aacda393c0896a522145",
    measurementId: "G-RPB15QJ9RH"
};

// Khởi tạo Firebase
console.log("Initializing Firebase with config:", firebaseConfig);
let db;
try {
    const app = initializeApp(firebaseConfig);
    console.log("Firebase initialized successfully:", app);
    db = getFirestore(app);
} catch (error) {
    console.error("Failed to initialize Firebase:", error);
    document.getElementById("error").textContent = "Failed to initialize Firebase: " + error.message;
    throw error; // Ném lỗi để dừng thực thi nếu Firebase không khởi tạo được
}

// Hàm lấy danh sách nhân vật từ Firestore
async function fetchCharactersFromFirebase() {
    if (!db) {
        throw new Error("Firestore database not initialized. Check Firebase configuration.");
    }
    try {
        console.log("Fetching characters from Firestore...");
        const querySnapshot = await getDocs(collection(db, "characters"));
        const characters = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            console.log("Document data:", data);
            characters.push({
                name: data.name,
                skelPath: data.skelPath,
                atlasPath: data.atlasPath,
                type: data.type
            });
        });
        console.log("Fetched characters from Firestore:", characters);
        if (characters.length === 0) {
            console.warn("No characters found in Firestore collection 'characters'.");
        }
        return characters;
    } catch (error) {
        console.error("Error fetching characters from Firestore:", error);
        throw new Error("Failed to fetch characters: " + error.message);
    }
}

// Xuất hàm để sử dụng trong các file khác
export { fetchCharactersFromFirebase };