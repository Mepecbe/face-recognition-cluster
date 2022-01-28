echo "==== START BUILD ===="

echo "COMPILE FILES"
tsc

echo "+ COPYING .PY FILES"
cp -v src/faceCheckerServer/faceChecker.py dist/faceCheckerServer/faceChecker.py

echo "+ COPYING .env files"
cp -v src/faceCheckerServer/.env dist/faceCheckerServer/.env
cp -v src/mainServer/.env dist/mainServer/.env

echo "==== BUILD COMPLETED ===="