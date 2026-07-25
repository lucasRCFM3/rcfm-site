"use client";

import { collectionGroup, onSnapshot } from "firebase/firestore";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronLeft, ChevronRight, Download, Gamepad2, Home,
  Library, Package, Search, Settings, Store, Trophy, Users, Wrench, X,
} from "lucide-react";
import { db } from "./firebase";

type Game = {
  id: string; parentId: string; title: string; coverUrl?: string; heroUrl?: string;
  genres?: string; version?: string; patch?: string; sizeBytes?: number;
  typeck?: "OnlineFix" | "Hypervisor" | "Nenhum"; installerUrl?: string;
};
type Page = "home" | "catalog" | "library";

const installerLink = (data: Record<string, unknown>) =>
  [data.portableInstallerDownloadUrl, data.portableInstallerUrl, data.installerUrl]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();

const formatBytes = (value?: number) => {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

export default function HomePage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("catalog");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<Game | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => onSnapshot(collectionGroup(db, "versions"), (snapshot) => {
    const records = snapshot.docs
      .filter((entry) => entry.ref.parent.parent?.parent?.id === "games")
      .map((entry) => {
        const data = entry.data() as Record<string, unknown>;
        return {
          id: entry.id,
          parentId: entry.ref.parent.parent?.id ?? entry.id,
          title: typeof data.title === "string" ? data.title : "Jogo sem título",
          coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : undefined,
          heroUrl: typeof data.heroUrl === "string" ? data.heroUrl : undefined,
          genres: typeof data.genres === "string" ? data.genres : undefined,
          version: typeof data.version === "string" ? data.version : undefined,
          patch: typeof data.patch === "string" ? data.patch : undefined,
          sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : undefined,
          typeck: data.typeck === "OnlineFix" || data.typeck === "Hypervisor" ? data.typeck : "Nenhum",
          installerUrl: installerLink(data),
        } satisfies Game;
      })
      .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    setGames(records); setLoading(false);
  }, () => setLoading(false)), []);

  const visibleGames = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("pt-BR");
    return text ? games.filter((game) => `${game.title} ${game.genres ?? ""}`.toLocaleLowerCase("pt-BR").includes(text)) : games;
  }, [games, query]);

  const switchPage = (next: Page) => { setPage(next); setSelected(null); };
  const disabledFeature = (name: string) => setUnavailable(name);

  return (
    <div className={`launcher-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="launcher-sidebar">
        <button className="collapse-button" type="button" onClick={() => setCollapsed((current) => !current)} aria-label="Recolher menu">
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <div className="launcher-logo"><img src="/rcfm_sem_fundo.png" alt="RCFM" /></div>
        <nav className="launcher-nav" aria-label="Navegação principal">
          <SidebarButton icon={<Home />} label="Início" active={page === "home"} onClick={() => switchPage("home")} />
          <div className={`nav-group ${page === "catalog" || page === "library" ? "active" : ""}`}>
            <button className="sidebar-button" type="button" onClick={() => switchPage("catalog")}><Library /><span>Jogos</span><ChevronDown className="dropdown-arrow" size={16} /></button>
            <div className="sidebar-subitems">
              <button className={page === "catalog" ? "active" : ""} type="button" onClick={() => switchPage("catalog")}>Catálogo</button>
              <button className={page === "library" ? "active" : ""} type="button" onClick={() => switchPage("library")}>Biblioteca</button>
            </div>
          </div>
          <SidebarButton icon={<Store />} label="Loja" onClick={() => disabledFeature("Loja")} />
          <SidebarButton icon={<Trophy />} label="Esports" onClick={() => disabledFeature("Esports")} />
          <SidebarButton icon={<Users />} label="Amigos" onClick={() => disabledFeature("Amigos")} />
        </nav>
        <nav className="launcher-nav bottom-nav">
          <SidebarButton icon={<Download />} label="Downloads" onClick={() => disabledFeature("Downloads")} />
          <SidebarButton icon={<Settings />} label="Configurações" onClick={() => disabledFeature("Configurações")} />
        </nav>
        <div className="web-profile"><div className="avatar">R</div><div><b>RCFM Web</b><small><i /> Online</small></div></div>
      </aside>

      <main className="launcher-main">
        {page === "home" && <EmptyLauncherPage title="BANNER CENTRAL / HOME" />}
        {page === "library" && <LibraryPage onBrowse={() => switchPage("catalog")} />}
        {page === "catalog" && !selected && (
          <section className="catalog-page">
            <header className="catalog-header">
              <div className="catalog-title"><h1>JOGOS ({games.length}) - {formatBytes(games.reduce((total, game) => total + (game.sizeBytes || 0), 0))}</h1><div /></div>
              <div className="catalog-actions">
                <label className="launcher-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jogos..." /></label>
                <div className="catalog-toggles" aria-label="Tipo de catálogo">
                  <button className="active" type="button" title="Jogos"><Gamepad2 size={18} /></button>
                  <button type="button" title="Ferramentas" onClick={() => disabledFeature("Ferramentas")}><Wrench size={18} /></button>
                  <button type="button" title="Utilitários" onClick={() => disabledFeature("Utilitários")}><Package size={18} /></button>
                </div>
              </div>
            </header>
            <div className="catalog-content">
              {loading ? <div className="launcher-empty">Carregando catálogo…</div> : visibleGames.length === 0 ? <div className="launcher-empty">Nenhum jogo encontrado.</div> : <div className="launcher-grid">
                {visibleGames.map((game) => <GameCard key={game.id} game={game} onOpen={() => setSelected(game)} />)}
              </div>}
            </div>
          </section>
        )}
        {selected && <GameDetails game={selected} onBack={() => setSelected(null)} />}
      </main>

      {unavailable && <UnavailableModal feature={unavailable} onClose={() => setUnavailable(null)} />}
    </div>
  );
}

function SidebarButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button className={`sidebar-button ${active ? "active" : ""}`} type="button" onClick={onClick}>{icon}<span>{label}</span></button>;
}

function GameCard({ game, onOpen }: { game: Game; onOpen: () => void }) {
  return <button className="launcher-game-card" type="button" onClick={onOpen}>
    <div className="launcher-cover">
      <span className="corner top-left" /><span className="corner bottom-right" />
      {game.typeck === "OnlineFix" && <em className="type-tag onlinefix">OnlineFix</em>}
      {game.typeck === "Hypervisor" && <em className="type-tag hypervisor">Hypervisor</em>}
      {game.coverUrl ? <img src={game.coverUrl} alt={`Capa de ${game.title}`} /> : <div className="cover-placeholder" />}
      <div className="cover-overlay"><span>VER DETALHES</span></div>
      {game.sizeBytes && <b className="size-tag">{formatBytes(game.sizeBytes)}</b>}
    </div>
    <div className="card-info"><h3>{game.title}</h3><p><span>Disponível</span>{game.version && <><i>•</i>{game.version}</>}</p>{game.genres && <small>{game.genres}</small>}</div>
  </button>;
}

function GameDetails({ game, onBack }: { game: Game; onBack: () => void }) {
  return <section className="game-details">
    <div className="details-hero" style={game.heroUrl ? { backgroundImage: `url(${game.heroUrl})` } : undefined} />
    <div className="details-shade" />
    <button className="back-button" type="button" onClick={onBack}><ChevronLeft size={18} /> Voltar ao catálogo</button>
    <div className="details-content">
      <p className="detail-overline">CATÁLOGO RCFM</p><h1>{game.title}</h1>
      <div className="detail-meta"><span>{game.typeck === "OnlineFix" ? "OnlineFix" : game.typeck === "Hypervisor" ? "Hypervisor" : "Jogo"}</span>{game.version && <span>{game.version}</span>}{game.patch && <span>{game.patch}</span>}{game.sizeBytes && <span>{formatBytes(game.sizeBytes)}</span>}</div>
      <p className="detail-description">{game.genres || "Jogo disponível no catálogo RCFM."}</p>
      {game.installerUrl ? <a className="portable-download" href={game.installerUrl} download><Download size={18} /> Baixar instalador</a> : <div className="installer-pending">Instalador portátil ainda não publicado para este jogo.</div>}
      <p className="browser-note">No navegador, o instalador faz o download do jogo fora do launcher.</p>
    </div>
  </section>;
}

function EmptyLauncherPage({ title }: { title: string }) { return <section className="launcher-empty large">{title}</section>; }
function LibraryPage({ onBrowse }: { onBrowse: () => void }) { return <section className="library-page"><h1>Minha Biblioteca</h1><p>Jogos instalados no seu computador aparecem no RCFM Launcher para Windows.</p><div className="library-empty"><Download size={58} /><h2>Nenhum jogo encontrado!</h2><p>O navegador não acessa suas pastas locais. Abra o launcher para consultar sua biblioteca instalada.</p><button type="button" onClick={onBrowse}>Visitar catálogo</button></div></section>; }
function UnavailableModal({ feature, onClose }: { feature: string; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><section className="unavailable-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={onClose}><X size={18} /></button><div className="modal-icon">!</div><h2>Funcionalidade Indisponível pra site</h2><p>{feature} funciona somente no RCFM Launcher para Windows.</p><button type="button" onClick={onClose}>Entendi</button></section></div>; }
