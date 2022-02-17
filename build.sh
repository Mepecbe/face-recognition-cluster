echo "==== START BUILD ======"

echo "==== COMPILE FILES ===="
tsc

echo "+ COPYING .PY FILES"
cp -v src/workerServer/faceChecker.py dist/workerServer/faceChecker.py

echo "+ COPYING .env files"
cp -v src/workerServer/.env dist/workerServer/.env
cp -v src/mainServer/.env dist/mainServer/.env

echo "=== BUILD COMPLETED ==="