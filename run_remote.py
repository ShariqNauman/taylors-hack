import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('instance.grafilab.ai', port=22, username='funny-icons-pump', password='RRLctRfbqZ0j')

import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

cmd = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else 'echo hello'
_, stdout, stderr = ssh.exec_command(cmd)
print("STDOUT:\n" + stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err:
    print("STDERR:\n" + err)
ssh.close()
