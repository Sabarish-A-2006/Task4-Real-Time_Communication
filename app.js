/**
 * Zoom-Clone Meeting Engine
 * Simplified professional logic
 */

class SocketManager {
  constructor(url) {
    this.socket = io(url, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
    });
    this.setupDefaultHandlers();
  }

  setupDefaultHandlers() {
    this.socket.on("connect", () => UI.showToast("Connected to server"));
    this.socket.on("disconnect", () =>
      UI.showToast("Disconnected from server", "danger"),
    );
  }

  emit(event, ...args) {
    this.socket.emit(event, ...args);
  }
  on(event, callback) {
    this.socket.on(event, callback);
  }
}

class PeerManager {
  constructor(socketManager) {
    this.socket = socketManager;
    this.peerConnections = {};
    this.iceConfig = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
  }

  async createPeerConnection(userId, localStream, isInitiator = false) {
    if (this.peerConnections[userId]) return this.peerConnections[userId];

    const pc = new RTCPeerConnection(this.iceConfig);
    this.peerConnections[userId] = pc;

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.ontrack = (event) => UI.addRemoteVideo(userId, event.streams[0]);
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.socket.emit("ice-candidate", userId, event.candidate);
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit("offer", userId, offer);
    }
    return pc;
  }

  async handleOffer(userId, offer, localStream) {
    const pc = await this.createPeerConnection(userId, localStream);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit("answer", userId, answer);
  }

  async handleAnswer(userId, answer) {
    const pc = this.peerConnections[userId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async handleIceCandidate(userId, candidate) {
    const pc = this.peerConnections[userId];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  removePeer(userId) {
    if (this.peerConnections[userId]) {
      this.peerConnections[userId].close();
      delete this.peerConnections[userId];
      UI.removeRemoteVideo(userId);
    }
  }

  async updateQualityStats() {
    for (const [userId, pc] of Object.entries(this.peerConnections)) {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          UI.updateQuality(userId, report.currentRoundTripTime * 1000);
        }
      });
    }
  }
}

const UI = {
  elements: {
    loginScreen: document.getElementById("login-screen"),
    videoRoom: document.getElementById("video-room"),
    videoGrid: document.getElementById("video-grid"),
    localVideo: document.getElementById("local-video"),
    localVideoContainer: document.getElementById("local-video-container"),
    chatPanel: document.getElementById("chat-panel"),
    chatMessages: document.getElementById("chat-messages"),
    messageInput: document.getElementById("message-input"),
    toastContainer: document.getElementById("toast-container"),
    roomName: document.getElementById("room-name"),
    participantCount: document.getElementById("participant-count"),
    settingsPanel: document.getElementById("settings-panel"),
    settingsOverlay: document.querySelector(".settings-overlay"),
  },

  init() {
    this.setupDraggableLocalVideo();
    this.handleAutoFill();
  },

  showToast(msg) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    this.elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },

  setupDraggableLocalVideo() {
    const pip = this.elements.localVideoContainer;
    let isDragging = false,
      startX,
      startY,
      offX = 0,
      offY = 0;

    pip.onmousedown = (e) => {
      isDragging = true;
      startX = e.clientX - offX;
      startY = e.clientY - offY;
    };

    window.onmousemove = (e) => {
      if (!isDragging) return;
      offX = e.clientX - startX;
      offY = e.clientY - startY;
      pip.style.transform = `translate(${offX}px, ${offY}px)`;
    };

    window.onmouseup = () => (isDragging = false);
  },

  addRemoteVideo(userId, stream) {
    if (document.getElementById(`tile-${userId}`)) return;
    const tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = `tile-${userId}`;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    const tag = document.createElement("div");
    tag.className = "name-tag";
    tag.textContent = "Remote Participant";
    const dot = document.createElement("div");
    dot.className = "quality-dot";
    tile.append(video, tag, dot);
    this.elements.videoGrid.appendChild(tile);
    this.updateLayout();
    this.setupSpeaking(stream, tile);
  },

  removeRemoteVideo(userId) {
    const tile = document.getElementById(`tile-${userId}`);
    if (tile) tile.remove();
    this.updateLayout();
  },

  updateLayout() {
    const count = this.elements.videoGrid.children.length;
    this.elements.videoGrid.style.gridTemplateColumns =
      count > 1 ? `repeat(${Math.ceil(Math.sqrt(count))}, 1fr)` : "1fr";
    this.elements.participantCount.textContent = `${count + 1} Participants`;
  },

  setupSpeaking(stream, tile) {
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const check = () => {
      analyser.getByteFrequencyData(data);
      const val = data.reduce((a, b) => a + b) / data.length;
      tile.classList.toggle("is-speaking", val > 20);
      requestAnimationFrame(check);
    };
    check();
  },

  updateQuality(userId, rtt) {
    const tile = document.getElementById(`tile-${userId}`);
    if (!tile) return;
    const dot = tile.querySelector(".quality-dot");
    dot.style.background =
      rtt < 100 ? "#2da44e" : rtt < 300 ? "#f1c40f" : "#e74c3c";
  },

  spawnEmoji(emoji) {
    const el = document.createElement("div");
    el.className = "floating-emoji";
    el.style.left = Math.random() * 80 + 10 + "%";
    el.textContent = emoji;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  },

  handleAutoFill() {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) document.getElementById("room-id").value = room;
  },
};

const app = {
  init() {
    UI.init();
    this.socket = new SocketManager("https://your-socket-server.com");
    this.peers = new PeerManager(this.socket);
    this.attachEvents();
    this.setupDevices();
  },

  attachEvents() {
    document.getElementById("join-btn").onclick = () => this.join();
    document.getElementById("leave-btn").onclick = () =>
      window.location.reload();
    document.getElementById("audio-btn").onclick = () => this.toggleAudio();
    document.getElementById("video-btn").onclick = () => this.toggleVideo();
    document.getElementById("screen-btn").onclick = () => this.toggleScreen();
    document.getElementById("record-btn").onclick = () => this.toggleRecord();
    document.getElementById("chat-toggle").onclick = () => this.toggleChat();
    document.getElementById("chat-close").onclick = () => this.toggleChat();
    document.getElementById("reactions-toggle").onclick = () => {
      const bar = document.getElementById("reactions-bar");
      bar.classList.toggle("hidden");
    };

    document.querySelectorAll(".reaction-item").forEach((btn) => {
      btn.onclick = () => {
        const emoji = btn.dataset.emoji;
        this.socket.emit("reaction", emoji);
        UI.spawnEmoji(emoji);
        document.getElementById("reactions-bar").classList.add("hidden");
      };
    });

    document.getElementById("send-btn").onclick = () => this.sendMsg();
    document.getElementById("copy-room-btn").onclick = () => this.copyLink();
    document.getElementById("settings-btn").onclick = () => this.toggleSet();
    document.getElementById("settings-close").onclick = () => this.toggleSet();

    this.socket.on("user-connected", (id, name) =>
      this.peers.createPeerConnection(id, this.localStream, true),
    );
    this.socket.on("user-disconnected", (id) => this.peers.removePeer(id));
    this.socket.on("offer", (id, offer) =>
      this.peers.handleOffer(id, offer, this.localStream),
    );
    this.socket.on("answer", (id, ans) => this.peers.handleAnswer(id, ans));
    this.socket.on("ice-candidate", (id, cand) =>
      this.peers.handleIceCandidate(id, cand),
    );
    this.socket.on("chat-message", (name, msg) => this.addMsg(msg, name));
    this.socket.on("reaction", (emoji) => UI.spawnEmoji(emoji));

    setInterval(() => this.peers.updateQualityStats(), 3000);
  },

  async setupDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === "videoinput");
    const mics = devices.filter((d) => d.kind === "audioinput");
    const camSel = document.getElementById("camera-select");
    const micSel = document.getElementById("mic-select");
    cams.forEach((d) =>
      camSel.add(new Option(d.label || "Camera", d.deviceId)),
    );
    mics.forEach((d) => micSel.add(new Option(d.label || "Mic", d.deviceId)));
  },

  async join() {
    this.username = document.getElementById("username").value.trim() || "Guest";
    this.roomId =
      document.getElementById("room-id").value.trim() ||
      Math.random().toString(36).substr(7);
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      document.getElementById("local-video").srcObject = this.localStream;
      UI.elements.loginScreen.classList.add("hidden");
      UI.elements.videoRoom.classList.remove("hidden");
      UI.elements.roomName.textContent = `Meeting ID: ${this.roomId}`;
      this.socket.emit("join-room", this.roomId, this.username);
    } catch (e) {
      UI.showToast("Failed to access media devices");
    }
  },

  toggleAudio() {
    const track = this.localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    const btn = document.getElementById("audio-btn");
    btn.classList.toggle("active", track.enabled);
    btn.querySelector("i").className = track.enabled
      ? "fas fa-microphone"
      : "fas fa-microphone-slash";
    btn.querySelector("span").textContent = track.enabled ? "Mute" : "Unmute";
  },

  toggleVideo() {
    const track = this.localStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    const btn = document.getElementById("video-btn");
    btn.classList.toggle("active", track.enabled);
    btn.querySelector("i").className = track.enabled
      ? "fas fa-video"
      : "fas fa-video-slash";
    btn.querySelector("span").textContent = track.enabled
      ? "Stop Video"
      : "Start Video";
  },

  async toggleScreen() {
    if (!this.sharing) {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      const track = this.screenStream.getVideoTracks()[0];
      track.onended = () => this.toggleScreen();
      this.replaceTrack(track);
      this.sharing = true;
      document.getElementById("screen-btn").classList.add("active");
    } else {
      const track = this.localStream.getVideoTracks()[0];
      this.replaceTrack(track);
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.sharing = false;
      document.getElementById("screen-btn").classList.remove("active");
    }
  },

  replaceTrack(track) {
    Object.values(this.peers.peerConnections).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track.kind === "video");
      if (sender) sender.replaceTrack(track);
    });
  },

  toggleChat() {
    document.getElementById("chat-panel").classList.toggle("open");
  },

  sendMsg() {
    const input = document.getElementById("message-input");
    const msg = input.value.trim();
    if (msg) {
      this.socket.emit("chat-message", msg);
      this.addMsg(msg, "Me");
      input.value = "";
    }
  },

  addMsg(msg, sender) {
    const el = document.createElement("div");
    el.className = "chat-msg";
    el.innerHTML = `<span class="sender">${sender}:</span><span>${msg}</span>`;
    UI.elements.chatMessages.appendChild(el);
    UI.elements.chatMessages.scrollTop = UI.elements.chatMessages.scrollHeight;
  },

  toggleRecord() {
    const btn = document.getElementById("record-btn");
    if (!this.recorder || this.recorder.state === "inactive") {
      this.chunks = [];
      this.recorder = new MediaRecorder(this.localStream);
      this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "record.webm";
        a.click();
      };
      this.recorder.start();
      btn.classList.add("active");
      UI.showToast("Recording started");
    } else {
      this.recorder.stop();
      btn.classList.remove("active");
      UI.showToast("Recording saved");
    }
  },

  copyLink() {
    const url =
      window.location.origin +
      window.location.pathname +
      "?room=" +
      this.roomId;
    navigator.clipboard
      .writeText(url)
      .then(() => UI.showToast("Meeting link copied"));
  },

  toggleSet() {
    const panel = document.getElementById("settings-panel");
    const overlay = document.querySelector(".settings-overlay");
    const isOpen = panel.style.display === "block";
    panel.style.display = isOpen ? "none" : "block";
    overlay.style.display = isOpen ? "none" : "block";
  },
};

window.onload = () => app.init();
