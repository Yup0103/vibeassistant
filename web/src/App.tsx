import { useEffect, useState } from "react";
import { me } from "./api";
import { Login } from "./components/Login";
import { Chat } from "./components/Chat";

export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    me().then((result) => setEmail(result?.email ?? null));
  }, []);

  if (email === undefined) return null; // brief loading flash, avoid a flicker to the login screen
  if (email === null) return <Login onLoggedIn={setEmail} />;
  return <Chat email={email} />;
}
