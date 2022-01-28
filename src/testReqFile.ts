import * as request from "request";
import * as fs from "fs";

request.post(
	"http://127.0.0.1:9032/fileUpload",
	{
		port: 9032,
		formData: {
			filedata: fs.createReadStream("me.jpg")
		}
	},
	(err, response, body) => {
		console.log("Файл загружен, идентификатор файла -> " + response.body);
	}
)