import { kiteMockLoginComplete } from "../api";

export function KiteLoginPrompt({
  loginUrl,
  mockMode,
  sessionId,
  onCompleted,
}: {
  loginUrl: string;
  mockMode: boolean;
  sessionId: string;
  onCompleted: () => void;
}) {
  async function handleClick(e: React.MouseEvent) {
    if (!mockMode) return; // real mode: let the anchor's href navigate normally
    e.preventDefault();
    await kiteMockLoginComplete(sessionId);
    onCompleted();
  }

  return (
    <div className="card kite-card">
      <span className="label">Kite · daily login</span>
      <div>Your Zerodha session isn't authenticated yet — this happens once a day.</div>
      <a
        className="login-link"
        href={loginUrl}
        target={mockMode ? undefined : "_blank"}
        rel="noreferrer"
        onClick={handleClick}
      >
        {mockMode ? "Log in to Zerodha (mock)" : "Log in to Zerodha"}
      </a>
    </div>
  );
}
