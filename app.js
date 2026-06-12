// Simple WebRTC Video Chat App
const socket = io("https://your-socket-server.com");
let peerConnections = {};
let localStream;
let screenStream;
let currentRoom;
let username;

// DOM Elements
const loginScreen = document.getElementById("login-screen");
const videoRoom = document.getElementById("video-room");
const roomName = document.getElementById("room-name");
const videoGrid = document.getElementById("video-grid");
const localVideo = document.getElementById("local-video");
const joinBtn = document.getElementById("join-btn");
const leaveBtn = document.getElementById("leave-btn");
const videoBtn = document.getElementById("video-btn");
const audioBtn = document.getElementById("audio-btn");
const screenBtn = document.getElementById("screen-btn");
const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatMessages = document.getElementById("chat-messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

// Event Listeners
joinBtn.addEventListener("click", joinRoom);
leaveBtn.addEventListener("click", leaveRoom);
videoBtn.addEventListener("click", toggleVideo);
audioBtn.addEventListener("click", toggleAudio);
screenBtn.addEventListener("click", toggleScreenShare);
chatToggle.addEventListener("click", () =>
  chatPanel.classList.toggle("hidden"),
);
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Join Room
async function joinRoom() {
  username = document.getElementById("username").value.trim();
  currentRoom =
    document.getElementById("room-id").value.trim() || generateRoomId();

  if (!username) {
    alert("Please enter your name");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;

    loginScreen.classList.add("hidden");
    videoRoom.classList.remove("hidden");
    roomName.textContent = `Room: ${currentRoom}`;

    socket.emit("join-room", currentRoom, username);
  } catch (err) {
    console.error("Error accessing media devices:", err);
    alert("Could not access camera/microphone");
  }
}

// Socket Events
socket.on("user-connected", (userId, userName) => {
  createPeerConnection(userId);
  addChatMessage(`${userName} joined the room`, "system");
});

socket.on("user-disconnected", (userId) => {
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
  }
  const videoEl = document.getElementById(userId);
  if (videoEl) videoEl.remove();
});

socket.on("offer", async (userId, offer) => {
  const pc = peerConnections[userId] || createPeerConnection(userId);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", userId, answer);
});

socket.on("answer", async (userId, answer) => {
  const pc = peerConnections[userId];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", (userId, candidate) => {
  const pc = peerConnections[userId];
  if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate));
});

socket.on("chat-message", (userName, message) => {
  addChatMessage(message, userName);
});

// WebRTC Functions
function createPeerConnection(userId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peerConnections[userId] = pc;

  // Add local stream tracks
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Handle remote stream
  pc.ontrack = (event) => {
    const video = document.createElement("video");
    video.id = userId;
    video.srcObject = event.streams[0];
    video.autoplay = true;
    video.playsInline = true;
    video.classList.add("remote-video");
    videoGrid.appendChild(video);
  };

  // ICE candidate handling
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", userId, event.candidate);
    }
  };

  return pc;
}

// Media Controls
function toggleVideo() {
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    videoBtn.classList.toggle("active");
  }
}

function toggleAudio() {
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    audioBtn.classList.toggle("active");
  }
}

async function toggleScreenShare() {
  if (!screenStream) {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const videoTrack = screenStream.getVideoTracks()[0];

    // Replace video track in all peer connections
    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      if (sender) sender.replaceTrack(videoTrack);
    });

    screenBtn.classList.add("active");
    videoTrack.onended = toggleScreenShare;
  } else {
    // Switch back to camera
    const videoTrack = localStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      if (sender) sender.replaceTrack(videoTrack);
    });

    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
    screenBtn.classList.remove("active");
  }
}

// Chat Functions
function sendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    socket.emit("chat-message", message);
    addChatMessage(message, "You");
    messageInput.value = "";
  }
}

function addChatMessage(message, sender) {
  const msgEl = document.createElement("div");
  msgEl.classList.add("chat-message");
  msgEl.textContent = sender === "system" ? message : `${sender}: ${message}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Helper Functions
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8);
}

function leaveRoom() {
  socket.emit("leave-room", currentRoom);

  // Close all peer connections
  Object.values(peerConnections).forEach((pc) => pc.close());
  peerConnections = {};

  // Stop all media streams
  if (localStream) localStream.getTracks().forEach((track) => track.stop());
  if (screenStream) screenStream.getTracks().forEach((track) => track.stop());

  // Reset UI
  videoGrid.innerHTML = "";
  chatMessages.innerHTML = "";
  videoRoom.classList.add("hidden");
  loginScreen.classList.remove("hidden");
}
