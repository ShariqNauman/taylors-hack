"""
deploy_to_graphilab.py - Automated deployment script for GraphiLab RTX 5090 GPU instance.
"""
import os
import re
import time
import paramiko

HOST = os.getenv("GRAPHILAB_HOST", "instance.grafilab.ai")
PORT = int(os.getenv("GRAPHILAB_PORT", "22"))
USER = os.getenv("GRAPHILAB_USER", "funny-icons-pump")
PASS = os.getenv("GRAPHILAB_PASSWORD", "RRLctRfbqZ0j")

print(f"Connecting to {USER}@{HOST}:{PORT}...")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
print("Connected!")

# 1. Upload edge_server.py
local_file = os.path.join(os.path.dirname(__file__), "edge", "edge_server.py")
sftp = ssh.open_sftp()
sftp.put(local_file, "/root/earlyeye/edge_server.py")
sftp.close()
print("Uploaded edge/edge_server.py to /root/earlyeye/edge_server.py!")

# 2. Restart edge_server and cloudflared
ssh.exec_command("pkill -f edge_server.py; pkill -f cloudflared")
time.sleep(1)

cmd_server = "nohup /root/earlyeye/venv/bin/python3 /root/earlyeye/edge_server.py > /root/earlyeye/server.log 2>&1 &"
ssh.exec_command(cmd_server)
time.sleep(3)

cmd_tunnel = "nohup /usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8765 > /root/earlyeye/tunnel.log 2>&1 &"
ssh.exec_command(cmd_tunnel)
print("Restarted edge_server.py and cloudflared tunnel on GraphiLab!")

# 3. Retrieve tunnel URL
public_url = None
for i in range(15):
    time.sleep(1)
    stdin, stdout, stderr = ssh.exec_command("cat /root/earlyeye/tunnel.log")
    log = stdout.read().decode()
    match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", log)
    if match:
        public_url = match.group(0)
        break

print("\n" + "=" * 60)
print(f"GRAPHILAB RTX 5090 PUBLIC URL: {public_url}")
print("=" * 60 + "\n")

ssh.close()
