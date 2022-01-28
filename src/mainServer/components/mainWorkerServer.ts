import { Logger, LogLevel } from "../../Logger";
import * as ExpressFramework from "express";
import * as BodyParser from "body-parser";
import { WorkerServer } from "./types";


/**Главный сервер, служит для связи и общения с другими серверами, которые занимаются поиском лица */
export class MainWorkerServer{
	private readonly Server: ExpressFramework.Express;
	private readonly Checker: NodeJS.Timer;


	/**====================WORKERS API========================*/
	private servers: WorkerServer[];
	/**====================WORKERS API========================*/

	
	


	async serversChecker(): Promise<void> {
		for(const srv of this.servers){
			await srv.checkConnection();
			await srv.getTasksCount();
		}
	}

	runServer(port: number): void {
		Logger.enterLog(`[MainWorkerServer] Запуск сервера на порту ${port}`, LogLevel.INFO);
		this.Server.listen(port);
	}

	constructor(
	){
		this.servers = [];

		this.Server = ExpressFramework();
		this.Server.use(BodyParser.json());
		//this.Server.use(BodyParser.urlencoded());

		this.Checker = setInterval(this.serversChecker.bind(this), parseInt(process.env.SERVER_CHECKER_TIMEOUT || "60") * 1000);

		//Connection checker
		this.Server.get(`/`, async (req, res) =>{
			res.statusCode = 200;
			res.end();
		});

		
		this.Server.get(`/addServer`, async (req, res) =>{
			const DESTINATION_SERVER_URL = req.query["ip"]?.toString();
			const DESTINATION_SERVER_PORT = req.query["port"]?.toString();
			const DESTINATION_SERVER_DIRS_COUNT = req.query["dirs"]?.toString();
			const DESTINATION_SERVER_CPU_COUNT = req.query["cpuCount"]?.toString();

			if (!DESTINATION_SERVER_CPU_COUNT
				|| !DESTINATION_SERVER_DIRS_COUNT
				|| !DESTINATION_SERVER_URL
				|| !DESTINATION_SERVER_PORT
			){
				Logger.enterLog(`Server not added, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
				res.statusCode = 400;
				res.end();
				return;
			}

			for (const srv of this.servers){
				if (srv.url == DESTINATION_SERVER_URL && srv.port == parseInt(DESTINATION_SERVER_PORT)){
					Logger.enterLog(`Server not added(ALREADY EXISTS), ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.WARN);
					return;
				}
			}

			this.servers.push(
				new WorkerServer(
					DESTINATION_SERVER_URL,
					parseInt(DESTINATION_SERVER_PORT),
					parseInt(DESTINATION_SERVER_CPU_COUNT),
					parseInt(DESTINATION_SERVER_DIRS_COUNT)
				)
			);

			Logger.enterLog(`Added new server, ${DESTINATION_SERVER_URL}:${DESTINATION_SERVER_PORT}, CPUs ${DESTINATION_SERVER_CPU_COUNT}, dirs ${DESTINATION_SERVER_DIRS_COUNT}`, LogLevel.INFO);

			res.statusCode = 200;
			res.end();
		});

		this.Server.post(`/`, async (req, res) => {
			const jsonData: unknown | null = req.body;
			res.statusCode = 200;
			res.end();
		});
	}
}