"use client";

import { collectionGroup, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";

type CatalogItem = {
  id: string;
  title: string;
  coverUrl?: string;
  heroUrl?: string;
  genres?: string;
  version?: string;
  sizeBytes?: number;
  installerUrl?: string;
};

const bytes = (value?: number) => {
  if (!value) return "Tamanho não informado";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index < 3 ? 0 : 1)} ${units[index]}`;
};

const installerLink = (data: Record<string, unknown>) => {
  const candidates = [
    data.portableInstallerDownloadUrl,
    data.portableInstallerUrl,
    data.installerUrl,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
};

export default function Home() {
  const [games, setGames] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<CatalogItem | null>(null);
  const [unavailableOpen, setUnavailableOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collectionGroup(db, "versions"),
      (snapshot) => {
        const catalog = snapshot.docs
          .filter((entry) => entry.ref.parent.parent?.parent?.id === "games")
          .map((entry) => {
            const data = entry.data() as Record<string, unknown>;
            return {
              id: entry.id,
              title: typeof data.title === "string" ? data.title : "Jogo sem título",
              coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : undefined,
              heroUrl: typeof data.heroUrl === "string" ? data.heroUrl : undefined,
              genres: typeof data.genres === "string" ? data.genres : undefined,
              version: typeof data.version === "string" ? data.version : undefined,
              sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : undefined,
              installerUrl: installerLink(data),
            } satisfies CatalogItem;
          })
          .sort((left, right) => left.title.localeCompare(right.title, "pt-BR"));

        setGames(catalog);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, []);

  const visibleGames = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized
      ? games.filter((game) => `${game.title} ${game.genres ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalized))
      : games;
  }, [games, query]);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="RCFM catálogo">RCFM<span>·</span></a>
        <nav aria-label="Navegação principal">
          <a className="active" href="#jogos">Jogos</a>
          <button type="button" onClick={() => setUnavailableOpen(true)}>Ferramentas</button>
          <button type="button" onClick={() => setUnavailableOpen(true)}>Utilitários</button>
        </nav>
        <a className="launcher-link" href="#como-funciona">Como funciona</a>
      </header>

      <section id="inicio" className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <p className="eyebrow">CATÁLOGO RCFM</p>
          <h1>Seu próximo jogo começa aqui.</h1>
          <p>Escolha um jogo, baixe o instalador portátil e instale na pasta que preferir.</p>
          <a className="primary-button" href="#jogos">Explorar catálogo <span>↓</span></a>
        </div>
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
      </section>

      <section id="jogos" className="catalog-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BIBLIOTECA</p>
            <h2>Jogos disponíveis</h2>
            <p className="muted">Catálogo sincronizado com o RCFM Launcher.</p>
          </div>
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jogo" />
          </label>
        </div>

        {loading ? (
          <div className="status-panel">Sincronizando catálogo…</div>
        ) : visibleGames.length === 0 ? (
          <div className="status-panel">Nenhum jogo encontrado.</div>
        ) : (
          <div className="game-grid">
            {visibleGames.map((game) => (
              <article className="game-card" key={game.id}>
                <button className="game-cover" type="button" onClick={() => setSelectedGame(game)}>
                  {game.coverUrl ? <img src={game.coverUrl} alt={`Capa de ${game.title}`} /> : <div className="cover-fallback" />}
                  <span>Ver jogo</span>
                </button>
                <div className="game-info">
                  <h3>{game.title}</h3>
                  <p>{game.genres || "Jogo"}</p>
                  <button className="download-button" type="button" onClick={() => setSelectedGame(game)}>Baixar instalador <span>↓</span></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="como-funciona" className="steps">
        <p className="eyebrow">SIMPLES E DIRETO</p>
        <h2>Como instalar</h2>
        <div className="step-grid">
          <div><b>01</b><h3>Baixe o instalador</h3><p>Escolha o jogo desejado no catálogo.</p></div>
          <div><b>02</b><h3>Defina a pasta</h3><p>Abra o arquivo e selecione onde instalar.</p></div>
          <div><b>03</b><h3>Jogue</h3><p>O instalador baixa e prepara o jogo para você.</p></div>
        </div>
      </section>

      <footer>RCFM Launcher <span>•</span> Catálogo web</footer>

      {selectedGame && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedGame(null)}>
          <section className="modal game-modal" role="dialog" aria-modal="true" aria-labelledby="game-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" type="button" onClick={() => setSelectedGame(null)} aria-label="Fechar">×</button>
            {selectedGame.heroUrl && <div className="modal-hero" style={{ backgroundImage: `url(${selectedGame.heroUrl})` }} />}
            <div className="modal-content">
              <p className="eyebrow">INSTALADOR PORTÁTIL</p>
              <h2 id="game-title">{selectedGame.title}</h2>
              <div className="meta"><span>{selectedGame.genres || "Jogo"}</span><span>{bytes(selectedGame.sizeBytes)}</span>{selectedGame.version && <span>v{selectedGame.version}</span>}</div>
              <p>O instalador é independente do launcher: escolha a pasta de destino e ele faz o download do jogo.</p>
              {selectedGame.installerUrl ? (
                <a className="primary-button full" href={selectedGame.installerUrl} download>Baixar instalador .exe <span>↓</span></a>
              ) : (
                <div className="not-ready">O instalador deste jogo ainda não foi publicado.</div>
              )}
            </div>
          </section>
        </div>
      )}

      {unavailableOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setUnavailableOpen(false)}>
          <section className="modal unavailable-modal" role="dialog" aria-modal="true" aria-labelledby="unavailable-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="lock-icon" aria-hidden="true">⌁</div>
            <p className="eyebrow">CATÁLOGO WEB</p>
            <h2 id="unavailable-title">Funcionalidade Indisponível pra site</h2>
            <p>Ferramentas e utilitários permanecem disponíveis apenas no RCFM Launcher para Windows.</p>
            <button className="primary-button full" type="button" onClick={() => setUnavailableOpen(false)}>Entendi</button>
          </section>
        </div>
      )}
    </main>
  );
}
