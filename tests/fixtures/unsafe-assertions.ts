interface EventRow {
  id: string;
}

declare function getExternalData(): unknown;

const value: unknown = getExternalData();
const rows = value as unknown as EventRow[];
const bareArray = value as EventRow[];
const record = value as Record<string, unknown>;

interface UserProfile { name: string; }
declare const someValue: unknown;
declare const jsonValue: unknown;
declare function getMsg(): string;

const safeCast = someValue as unknown as string;
const data = jsonValue as unknown as UserProfile[];
const msg = getMsg();

export { EventRow, UserProfile };
