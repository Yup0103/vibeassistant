import { kiteMockLoginComplete } from "../api";
import { TrendingIcon } from "../icons";

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
    <div className="card">
      <div className="card-head">
        <div className="card-icon kite">
          <TrendingIcon size={14} />
        </div>
        <span className="label">Kite · daily login</span>
      </div>
      <div className="body">Your Zerodha session isn't authenticated yet — this happens once a day.</div>
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
