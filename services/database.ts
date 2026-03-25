import * as SQLite from 'expo-sqlite';

// Type definition for our User to keep TS happy
export interface UserProfile {
  id?: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dob: string;
  weight: number;
  height: string;
  age: number;
  skinTone: number;
}

const dbPromise = SQLite.openDatabaseAsync('profile.db');

export const initDatabase = async (): Promise<void> => {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY NOT NULL,
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      email TEXT,
      dob TEXT,
      weight INTEGER,
      height TEXT,
      age INTEGER,
      skinTone INTEGER
    );
  `);
};

export const saveProfile = async (user: UserProfile): Promise<void> => {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT OR REPLACE INTO profile (id, firstName, lastName, phone, email, dob, weight, height, age, skinTone) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [1, user.firstName, user.lastName, user.phone, user.email, user.dob, user.weight, user.height, user.age, user.skinTone]
  );
};

export const getProfile = async (): Promise<UserProfile | null> => {
  const db = await dbPromise;
  const result = await db.getFirstAsync<UserProfile>('SELECT * FROM profile WHERE id = 1');
  return result;
};