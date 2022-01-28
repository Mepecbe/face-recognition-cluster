import { WorkerServer } from "./types";

export class Utils {
	/**Отсеять самый мощный сервер */
	public static parseCpuCount(servers: WorkerServer[]): WorkerServer {
		if (servers.length == 0){
			throw new Error("Servers list is empty");
		}

		let w: WorkerServer = servers[0];

		for(let first = 1; first < servers.length; first++){
			for(let second = 1; second < servers.length; second++){
				if (first == second){
					continue;
				}

				if (w.cpu_count < servers[second].cpu_count){
					w = servers[second];
				}
			}
		}

		return w;
	}
	
	/**Отсеять самый не загруженный сервер*/
	public static parseTasksCount(servers: WorkerServer[]): WorkerServer {
		if (servers.length == 0){
			throw new Error("Servers list is empty");
		}

		let w: WorkerServer = servers[0];

		for(let first = 1; first < servers.length; first++){
			for(let second = 1; second < servers.length; second++){
				if (first == second){
					continue;
				}

				if (w.tasksCount > servers[second].tasksCount){
					w = servers[second];
				}
			}
		}

		return w;
	}
}