import { isValidCron } from "cron-validator";

export function validateCron(expression: string): boolean {
  try {
    return isValidCron(expression, {
      seconds: false,
      alias: true,
      allowBlankDay: true,
    });
  } catch {
    return false;
  }
}
