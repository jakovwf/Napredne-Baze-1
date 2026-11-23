export type Role = "user" | "admin";

/** korisnik onako kako ga vidi klijent (nikad sa password_hash) */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}
