
import asyncio, sys, os, time, time, dlib
import face_recognition
import requests

#Идентификатор задачи
TASK_ID = sys.argv[1]
#Исходная фотография(лицо изображенное на которой мы ищем)
SOURCE_IMAGE = sys.argv[2]
#Директория с фотографиями, с которыми производим сверку
TARGET_DIR = sys.argv[3]
#Порт сервера HTTP на который нужно отправлять информацию о процессе
SERVER_PORT = sys.argv[4]
#Путь, куда скрипт будет сохранять логи проверок
SCRIPT_REPORTS_DIR = 'py_reports/'
#Путь к серверу HTTP
SERVER_URL = "http://127.0.0.1:{0}/taskResult".format(SERVER_PORT)

start_time = time.time()
result = False

f = open(
	"{dir}{filename}".format(
		dir=SCRIPT_REPORTS_DIR, 
		filename=TASK_ID.replace("-", "") + ".report"
	), "a"
)

def checkFile(file, my_face_encoding):
    global result
    global f

    f.write("[{1:f}] Check image {0} ->".format(file, (time.time() - start_time)))

    unknown_picture = face_recognition.load_image_file(file)

    try:
        unknown_face_encoding = face_recognition.face_encodings(unknown_picture)[0]
    except:
        f.write("FACE ON IMAGE NOT FOUND\n")
        requests.get('{URL}?action=error&id={ID}&code={code}&file={FILE}'.format(URL=SERVER_URL, ID=TASK_ID, FILE=file, code=0x10))
        return

    # Now we can see the two face encodings are of the same person with `compare_faces`!

    results = face_recognition.compare_faces([my_face_encoding], unknown_face_encoding)

    if (results[0]):
        f.write("FACE FOUND\n")
        result = True
    else:
        f.write("FACE NOT FOUND\n")

#system args - 
#		1 - идентификатор задачи
#		2 - путь к исходному файлу,
#		2 - директория с файлами jpg(с которыми проверка происходит)
#		3 - порт сервера

def main():
    global f
    picture_of_me = face_recognition.load_image_file(SOURCE_IMAGE)
    my_face_encoding = face_recognition.face_encodings(picture_of_me)[0]

    f.write("[{0}] LOADED SOURCE {1}\n".format(time.time() - start_time, SOURCE_IMAGE))

    requests.get('{0}?action=start&id={1}'.format(SERVER_URL, TASK_ID))

    # my_face_encoding now contains a universal 'encoding' of my facial features that can be compared to any other picture of a face!
    for file in os.listdir(TARGET_DIR):
        if file.endswith(".jpg"):
            checkFile(TARGET_DIR + file, my_face_encoding)

    requests.get('{0}?action=result&id={1}&status={status}&file={2}'.format(SERVER_URL, TASK_ID, file, status=result))
    f.write('[{time}]TASK END. ID {id}, result {status}\n'.format(id = TASK_ID, status = result, time=time.time() - start_time))
    f.close()

main()