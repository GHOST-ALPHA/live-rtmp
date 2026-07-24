# Naxatra News Live RTMP Ingestion & Broadcasting Server

A highly secure, high-performance, and isolated RTMP ingestion server fronted by Nginx with Let's Encrypt SSL/TLS certs. This serves as the self-hosted broadcasting backend replacing external media providers (like Livebox) for **Naxatra News Live TV**.

---

## 📺 Architecture Overview

This server provides **ultra-low latency (< 2s)** HLS broadcasting securely:

```mermaid
graph TD
    subgraph Host / Camera
        Kiloview[Kiloview Hardware Encoder] -- RTMP Ingest (1935) with psk key --> NMS_RTMP
    end

    subgraph Docker Container Stack
        NMS_RTMP[Node Media Server Ingest] -- Validate prePublish -- Verify psk --> AuthCheck
        AuthCheck -- If valid --> Transmute[Transcode RTMP to HLS via FFmpeg]
        Transmute -- Generate index.m3u8 & .ts segments --> Disk[(Shared Volume)]
        
        NMS_HTTP[NMS Stream Server] -- Serve files -- Port 8001 --> Nginx
        Nginx[Nginx SSL Reverse Proxy] -- Reverse Proxy HTTPS -- Port 443 --> Browser[User Web Player]
    end

    subgraph Production Website
        NextJS[Next.js App Frontend] -- Embed HLS Player --> Browser
    end

    Browser -- Fetch https://live.naxatranewshindi.com/live-feed/stream/index.m3u8 --> Nginx
```

---

## ⚙️ Ingestion Credentials

To push your video feed from your encoder, use these coordinates:

* **RTMP Server Address (URL)**: `rtmp://live.naxatranewshindi.com/live`
* **Stream Key (Push Point)**: `stream?psk=naxatra_1a2b3c4d`
* **Complete Ingestion Ingest URL**: `rtmp://live.naxatranewshindi.com/live/stream?psk=naxatra_1a2b3c4d`

*Note: Any connections attempting to push stream packets to different keys or without the exact pre-shared key parameter `psk=naxatra_1a2b3c4d` will be automatically rejected by the server ingestion hooks.*

---

## 🚀 Production Server Deployment (IP: 159.89.170.164)

Follow these steps to deploy this setup on your production server:

### 1. Transfer Project Files
Copy the following files to the directory `/opt/rtmp-server/` on your server:
- `package.json`
- `server.js`
- `Dockerfile`
- `nginx.conf`
- `docker-compose.yml`
- `init-ssl.sh`

### 2. Configure DNS
Ensure that the A record for your subdomain `live` is mapped to your server IP:
* **Subdomain**: `live.naxatranewshindi.com`
* **Points to**: `159.89.170.164`

### 3. Bootstrap SSL Certificates
Run the bootstrap script to create the temporary certificates, start Nginx, request Let's Encrypt certificates, and load the final configuration:
```bash
chmod +x init-ssl.sh
sudo ./init-ssl.sh
```

### 4. Continuous Running
Once bootstrapped, Nginx, Certbot (auto-renewing every 12 hours), and the Node RTMP server will run continuously in the background:
```bash
docker compose ps
```

---

## 🔗 Multi-Streaming / Simulcast (YouTube & Facebook Live)

The server supports automatic forwarding of your live stream to **YouTube Live** and **Facebook Live** concurrently, without requiring additional upload bandwidth from your studio.

### How to Configure Stream Keys:
1. Create a local `.env` file in the `/opt/rtmp-server/live-rtmp/` folder on your server:
   ```env
   # YouTube Stream Key (e.g. abcd-efgh-ijkl-mnop-qrst)
   YOUTUBE_STREAM_KEY=your-youtube-stream-key
   
   # Facebook Stream Key (e.g. FB-1234567890...)
   FACEBOOK_STREAM_KEY=your-facebook-stream-key
   ```
2. Restart the container stack to apply the keys:
   ```bash
   docker compose down
   docker compose up --build -d rtmp-server
   ```
   *If you do not define a key, that specific relay will remain inactive, but other active streams will function normally.*

---

## 🔌 Hardware Setup: Kiloview Encoder

Configuring the Kiloview hardware encoder to push directly to this server:

1. **Video/Audio Input**: Connect your SDI/HDMI source to the encoder.
2. **Access Web Interface**: Enter the encoder's IP address in your browser and log in.
3. **Set Encoding parameters**:
   - **Video Codec**: `H.264` (Main or High Profile)
   - **Rate Control**: `CBR` (Constant Bitrate) - *Crucial for frame stability!*
   - **Bitrate**: `3000 Kbps - 4000 Kbps` (for 1080p stream)
   - **Frame Rate**: `25` or `30` FPS
   - **Keyframe (GOP) Interval**: `2 seconds` (or `50/60` frames) - *Crucial for player startup speed!*
   - **Audio Codec**: `AAC` at `128 Kbps`.
4. **Setup Push**:
   - Go to **Stream Service** -> Click **Add RTMP Push Service**.
   - **Push URL**: `rtmp://live.naxatranewshindi.com/live`
   - **Stream Name / Key**: `stream?psk=naxatra_1a2b3c4d`
   - Turn the service toggle **ON** and click **Save**.

---

## 📹 Software Setup: OBS Studio (Fallback/Testing)

If streaming from a computer:
1. Open **Settings** -> **Stream**.
2. **Service**: `Custom...`
3. **Server**: `rtmp://live.naxatranewshindi.com/live`
4. **Stream Key**: `stream?psk=naxatra_1a2b3c4d`
5. Go to **Output** -> Set Output Mode to `Advanced`:
   - Set Rate Control to `CBR`, Bitrate to `3500 Kbps`, and Keyframe Interval to `2`.
6. Click **Start Streaming**.

---

## 🔗 Next.js Main Web Integration

To load this HLS stream inside the Next.js production site player:

### 1. Update the Environment configuration
Open the `.env` file of your Next.js application (`main` folder) and update the Live TV coordinates:

```env
# =========================
# Live TV Configuration
# =========================
NEXT_PUBLIC_LIVE_TV_URL=https://live.naxatranewshindi.com/live-feed/stream/index.m3u8
NEXT_PUBLIC_LIVE_TV_ENABLED=true
```

### 2. Live TV Settings Action Panel (Dynamic Toggle)
To support toggling the stream dynamically from your Next.js dashboard admin panel:
- Create [live-tv.ts](file:///d:/WORKSPACE/FEATURE%20WORKSPACE/rtmp/main/lib/actions/live-tv.ts) action file on the Next.js server to read/write configurations.
- Use `getLiveTvSettings()` inside [live-tv-player.tsx](file:///d:/WORKSPACE/FEATURE%20WORKSPACE/rtmp/main/components/widgets/live-tv-player.tsx) to dynamically control playback stream URL and status.
*(For detailed code files of the Next.js admin page settings UI, refer to the saved components inside your local `.agents` or system logs).*
