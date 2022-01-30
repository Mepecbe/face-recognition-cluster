import { Colors } from "rg";
export enum LogLevel {
	INFO,
	WARN,
	ERROR
}

export class Logger {
	private static blockState: boolean = false;
	private static queue: string[] = [];

	public static enterLog(text: string, level: LogLevel): void {
		if (this.blockState){
			this.queue.push(this.getMessage(text, level));
		} else {
			console.log(this.getMessage(text, level));
		}
	}

	public static getMessage(text: string, level: LogLevel): string {
		switch (level){
			case LogLevel.INFO: {
				return `[${Colors.FgGreen + "*" + Colors.Reset}] ${text}`;
			}
			
			case LogLevel.WARN: {
				return `[${Colors.FgYellow + "*" + Colors.Reset}] ${text}`;
			}
			
			case LogLevel.ERROR: {
				return `[${Colors.FgRed + "*" + Colors.Reset}] ${text}` ;
			}
		}
	}

	/**Поставить блокировку на вывод в консоль
	 * если блокировка снимается, то производится вывод из очереди сообщений и снятие блока
	 */
	public static blockMessages(state?: boolean): boolean {
		if (typeof(state) !== "undefined"){
			if (this.blockState && !state) {
				//Снятие блокировки
				while (this.queue.length > 0){
					console.log(this.queue.shift());
				}
			}

			Logger.blockState = state;
		}

		return this.blockState;
	}
}