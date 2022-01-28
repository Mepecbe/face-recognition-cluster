import { Colors } from "rg";
export enum LogLevel {
	INFO,
	WARN,
	ERROR
}

export class Logger {
	public static enterLog(text: string, level: LogLevel): void {
		switch (level){
			case LogLevel.INFO: {
				console.log(`[${Colors.FgGreen + "*" + Colors.Reset}] ${text}`);
				break;
			}
			
			case LogLevel.WARN: {
				console.log(`[${Colors.FgYellow + "*" + Colors.Reset}] ${text}`);
				break;
			}
			
			case LogLevel.ERROR: {
				console.log(`[${Colors.FgRed + "*" + Colors.Reset}] ${text}`);
				break;
			}
		}
	}
}