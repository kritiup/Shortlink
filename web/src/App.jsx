import React, { useEffect, useState } from 'react';

export default function App() {
  const [url, setUrl] = useState('');
  const [links, setLinks] = useState([]);
  const [stats, setStats] = useState({});
  const [error, setError] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/links');
      const d = await r.json();
      setLinks(d.links || []);
    } catch {
      setError('could not reach the api');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError('');
    try {
      const r = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error || 'request failed');
      }
      setUrl('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function refreshStats(code) {
    const r = await fetch(`/api/links/${code}/stats`);
    if (r.ok) {
      const d = await r.json();
      setStats((s) => ({ ...s, [code]: d.clicks }));
    }
  }

  return (
    <div className="wrap">
      <h1>ShortLink</h1>
      <p className="sub">
        A microservices demo &mdash; nginx &middot; Node &middot; Go &middot; Python &middot;
        Postgres &middot; Redis
      </p>

      <div className="row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="https://example.com/a/very/long/url"
        />
        <button onClick={create}>Shorten</button>
      </div>
      {error && <p className="err">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Short link</th>
            <th>Target</th>
            <th>Clicks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {links.length === 0 && (
            <tr>
              <td colSpan="4" className="empty">
                No links yet &mdash; shorten one above.
              </td>
            </tr>
          )}
          {links.map((l) => (
            <tr key={l.code}>
              <td>
                <a href={`/r/${l.code}`} target="_blank" rel="noreferrer">
                  /r/{l.code}
                </a>
              </td>
              <td className="target" title={l.target_url}>
                {l.target_url}
              </td>
              <td>{stats[l.code] ?? '—'}</td>
              <td>
                <button className="ghost" onClick={() => refreshStats(l.code)}>
                  stats
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
