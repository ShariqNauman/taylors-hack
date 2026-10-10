"""
setup_and_run_graphilab.py - Full pipeline deployment to GraphiLab RTX 5090
"""
import os
import re
import sys
import time
import paramiko

HOST = os.getenv("GRAPHILAB_HOST", "instance.grafilab.ai")
PORT = int(os.getenv("GRAPHILAB_PORT", "22"))
USER = os.getenv("GRAPHILAB_USER", "funny-icons-pump")
PASS = os.getenv("GRAPHILAB_PASSWORD", "RRLctRfbqZ0j")

REPO_DIR = os.path.dirname(os.path.abspath(__file__))

print(f"[*] Connecting to {USER}@{HOST}:{PORT}...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
print("[+] SSH Connected successfully!")

def run_cmd(cmd, desc=""):
    if desc:
        print(f"[*] {desc}...")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    return out, err

# 1. Wait for any running uv process to complete
for _ in range(60):
    out, _ = run_cmd("ps aux | grep 'uv pip install' | grep -v grep")
    if not out:
        break
    print("    Waiting for active uv pip install to finish...")
    time.sleep(5)

# 2. Verify torch and install other dependencies
print("[*] Checking PyTorch...")
out, err = run_cmd("/root/earlyeye/venv/bin/python -c 'import torch; print(\"TORCH_OK\", torch.__version__, torch.cuda.is_available())'")
print("    Torch check:", out, err)

print("[*] Installing ultralytics, lightgbm, opencv-python-headless, pandas, joblib, lapx...")
cmd_deps = "/root/.local/bin/uv pip install --python /root/earlyeye/venv/bin/python ultralytics lightgbm opencv-python-headless pandas joblib lapx"
out, err = run_cmd(cmd_deps, "Installing remaining ML dependencies")
print("    Dependencies installed.")

# 3. Verify CUDA device
out, _ = run_cmd("/root/earlyeye/venv/bin/python -c 'import torch; print(\"CUDA:\", torch.cuda.get_device_name(0))'")
print(f"[+] GPU verification: {out}")

# 4. Upload all required files via SFTP
sftp = ssh.open_sftp()
files_to_upload = [
    (os.path.join(REPO_DIR, "edge", "edge_server.py"), "/root/earlyeye/edge_server.py"),
    (os.path.join(REPO_DIR, "model", "yolo26n-pose.pt"), "/root/earlyeye/yolo26n-pose.pt"),
    (os.path.join(REPO_DIR, "model", "violence_model.joblib"), "/root/earlyeye/violence_model.joblib"),
    (os.path.join(REPO_DIR, "model", "bytetrack_v2.yaml"), "/root/earlyeye/bytetrack_v2.yaml"),
    (os.path.join(REPO_DIR, "model", "predict.py"), "/root/earlyeye/predict.py"),
    (os.path.join(REPO_DIR, "model", "features.py"), "/root/earlyeye/features.py"),
    (os.path.join(REPO_DIR, "model", "seq_features.py"), "/root/earlyeye/seq_features.py"),
    (os.path.join(REPO_DIR, "model", "seq_model.onnx"), "/root/earlyeye/seq_model.onnx"),
    (os.path.join(REPO_DIR, "model", "seq_clip.json"), "/root/earlyeye/seq_clip.json"),
    (os.path.join(REPO_DIR, "model", "guards.py"), "/root/earlyeye/guards.py"),
]

for local_path, remote_path in files_to_upload:
    if os.path.exists(local_path):
        size_mb = os.path.getsize(local_path) / (1024 * 1024)
        print(f"[*] Uploading {os.path.basename(local_path)} ({size_mb:.2f} MB)...")
        sftp.put(local_path, remote_path)
        print(f"    [+] Uploaded to {remote_path}")
    else:
        print(f"    [!] Warning: {local_path} not found locally!")

sftp.close()

# 5. Stop any existing instances
print("[*] Stopping previous edge_server and cloudflared processes...")
run_cmd("pkill -9 -f edge_server.py; pkill -9 -f cloudflared")
time.sleep(1)

# 6. Start edge_server in background
print("[*] Launching edge_server.py on GraphiLab RTX 5090...")
run_cmd("nohup /root/earlyeye/venv/bin/python3 /root/earlyeye/edge_server.py > /root/earlyeye/server.log 2>&1 &")
time.sleep(3)

# 7. Start cloudflared tunnel
print("[*] Launching Cloudflare Tunnel on port 8765...")
run_cmd("nohup /usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8765 > /root/earlyeye/tunnel.log 2>&1 &")

# 8. Retrieve public tunnel URL
public_url = None
print("[*] Waiting for public Cloudflare tunnel URL...")
for i in range(25):
    time.sleep(1)
    out, _ = run_cmd("cat /root/earlyeye/tunnel.log")
    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", out)
    if match:
        public_url = match.group(0)
        break

print("\n" + "=" * 70)
print(f" EARLYEYE GRAPHILAB RTX 5090 LIVE URL: {public_url}")
print("=" * 70 + "\n")

# Check server health
if public_url:
    out, _ = run_cmd("curl -s http://127.0.0.1:8765/health")
    print(f"[*] Local Edge Health Check: {out}")

# Print recent server log lines
out, _ = run_cmd("tail -n 20 /root/earlyeye/server.log")
print(f"[*] Edge Server Log:\n{out}")

ssh.close()
