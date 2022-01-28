import { ApiServer } from "./components/ApiServer";
import 'dotenv/config';
import { MainWorkerServer } from "./components/mainWorkerServer";

async function main(): Promise<void> {
	const mainWorkerServer = new MainWorkerServer();
	
	const server = new ApiServer(mainWorkerServer);
	server.runServer(8080);

	mainWorkerServer.runServer(parseInt(process.env.MAIN_WORKER_SERVER_PORT || "9010"));
}

main();