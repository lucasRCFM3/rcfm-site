"use client";

import { collectionGroup, onSnapshot } from "firebase/firestore";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
  Gamepad2,
  Home,
  Library,
  LoaderCircle,
  Package,
  Search,
  Settings,
  SlidersHorizontal,
  Store,
  Trophy,
  Users,
  Wrench,
  X,
  MoreHorizontal,
} from "lucide-react";
import { db } from "./firebase";
import { HlsVideoPlayer } from "./components/HlsVideoPlayer";
import "./launcher.css";

type Game = {
  id: string;
  parentId: string;
  appId?: string;
  title: string;
  coverUrl?: string;
  heroUrl?: string;
  genres?: string;
  version?: string;
  patch?: string;
  sizeBytes?: number;
  isOutdated?: boolean;
  typeck: "OnlineFix" | "Hypervisor" | "Nenhum";
  installerUrl?: string;
  trailerUrl?: string;
};

type GameGroup = {
  identity: string;
  versions: Game[];
};

type Page = "home" | "catalog" | "library";
type Filter = "all" | "onlinefix" | "hypervisor" | "normal";
type Sort = "title-asc" | "title-desc" | "onlinefix-first" | "hypervisor-first" | "normal-first";

const installerLink = (data: Record<string, unknown>) =>
  [data.portableInstallerUrl, data.portableInstallerDownloadUrl, data.installerUrl]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
    ?.trim();

const formatBytes = (value?: number) => {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
};

const isMediaFireLink = (value: string) => {
  try {
    const host = new URL(value).hostname;
    return host === "mediafire.com" || host.endsWith(".mediafire.com");
  } catch {
    return false;
  }
};

const catalogVersionCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

const catalogCompleteness = (game: Game) =>
  (game.installerUrl ? 8 : 0)
  + (game.sizeBytes ? 4 : 0)
  + (game.coverUrl ? 2 : 0)
  + (game.heroUrl ? 2 : 0)
  + (game.version ? 1 : 0)
  + (game.patch ? 1 : 0)
  + (game.genres ? 1 : 0)
  + (game.typeck !== "Nenhum" ? 1 : 0);

const catalogIdentity = (game: Game) =>
  game.appId?.trim()
    ? `app:${game.appId.trim()}`
    : `title:${game.title.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ")}`;

const releaseIdentity = (game: Game) =>
  `${catalogIdentity(game)}\u0000${game.version?.trim() ?? ""}\u0000${game.patch?.trim() ?? ""}`;

const gameRoutePath = (game: Game) => `/${encodeURIComponent(
  game.id.trim()
  || [game.appId || game.parentId, game.version || "sem-versao", game.patch || "sem-patch"].join("_"),
)}`;

const currentRoutePath = () => {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path || "/";
};

const compareGameVersions = (left: Game, right: Game) =>
  catalogVersionCollator.compare(right.version ?? "", left.version ?? "")
  || catalogVersionCollator.compare(right.patch ?? "", left.patch ?? "")
  || catalogCompleteness(right) - catalogCompleteness(left)
  || right.id.localeCompare(left.id);

const groupCatalogVersions = (records: Game[]): GameGroup[] => {
  const bestRelease = new Map<string, Game>();
  for (const game of records) {
    const release = releaseIdentity(game);
    const current = bestRelease.get(release);
    if (
      !current
      || catalogCompleteness(game) > catalogCompleteness(current)
      || (
        catalogCompleteness(game) === catalogCompleteness(current)
        && game.id.localeCompare(current.id) > 0
      )
    ) {
      bestRelease.set(release, game);
    }
  }

  const versionsByGame = new Map<string, Game[]>();
  for (const game of bestRelease.values()) {
    const identity = catalogIdentity(game);
    const versions = versionsByGame.get(identity) ?? [];
    versions.push(game);
    versionsByGame.set(identity, versions);
  }

  return [...versionsByGame.entries()]
    .map(([identity, versions]) => ({
      identity,
      versions: [...versions].sort(compareGameVersions),
    }))
    .sort((left, right) =>
      left.versions[0].title.localeCompare(right.versions[0].title, "pt-BR"));
};

const matchesFilter = (game: Game, filter: Filter) =>
  filter === "all"
  || (filter === "onlinefix" && game.typeck === "OnlineFix")
  || (filter === "hypervisor" && game.typeck === "Hypervisor")
  || (filter === "normal" && game.typeck === "Nenhum");

export default function HomePage() {
  const [gameGroups, setGameGroups] = useState<GameGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("catalog");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("title-asc");
  const [collapsed, setCollapsed] = useState(false);
  const [selected, setSelected] = useState<Game | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [showTrailer, setShowTrailer] = useState(false);
  const [isHoveringBanner, setIsHoveringBanner] = useState(false);
  const [featuredGamesList, setFeaturedGamesList] = useState<Game[]>([]);

  useEffect(() => onSnapshot(
    collectionGroup(db, "versions"),
    (snapshot) => {
      const records = snapshot.docs
        .filter((entry) => entry.ref.parent.parent?.parent?.id === "games")
        .map((entry) => {
          const data = entry.data() as Record<string, unknown>;
          return {
            id: entry.id,
            parentId: entry.ref.parent.parent?.id ?? entry.id,
            appId: typeof data.appId === "string"
              ? data.appId
              : typeof data.appId === "number"
                ? String(data.appId)
                : undefined,
            title: typeof data.title === "string" ? data.title : "Jogo sem título",
            coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : undefined,
            heroUrl: typeof data.heroUrl === "string" ? data.heroUrl : undefined,
            genres: typeof data.genres === "string" ? data.genres : undefined,
            version: typeof data.version === "string" ? data.version : undefined,
            patch: typeof data.patch === "string" ? data.patch : undefined,
            sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : undefined,
            isOutdated: typeof data.isOutdated === "boolean" ? data.isOutdated : undefined,
            typeck: data.typeck === "OnlineFix" || data.typeck === "Hypervisor"
              ? data.typeck
              : "Nenhum",
            installerUrl: installerLink(data),
            trailerUrl: typeof data.trailerUrl === "string" ? data.trailerUrl : undefined,
          } satisfies Game;
        });
      setGameGroups(groupCatalogVersions(records));
      setLoading(false);
    },
    () => setLoading(false),
  ), []);

  const visibleGroups = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("pt-BR");
    const priority = sort === "onlinefix-first"
      ? "OnlineFix"
      : sort === "hypervisor-first"
        ? "Hypervisor"
        : sort === "normal-first"
          ? "Nenhum"
          : undefined;

    return [...gameGroups]
      .filter(({ versions }) => versions.some((game) =>
        (!text || `${game.title} ${game.genres ?? ""}`.toLocaleLowerCase("pt-BR").includes(text))
        && matchesFilter(game, filter)))
      .sort((left, right) => {
        const leftGame = left.versions[0];
        const rightGame = right.versions[0];
        if (
          priority
          && (leftGame.typeck === priority) !== (rightGame.typeck === priority)
        ) {
          return Number(rightGame.typeck === priority) - Number(leftGame.typeck === priority);
        }
        const byTitle = leftGame.title.localeCompare(rightGame.title, "pt-BR");
        return sort === "title-desc" ? -byTitle : byTitle;
      });
  }, [gameGroups, query, filter, sort]);

  const latestGames = gameGroups.map(({ versions }) => versions[0]);
  const openGame = (game: Game) => {
    const path = gameRoutePath(game);
    if (currentRoutePath() !== path) {
      window.history.pushState({ rcfmCatalogNavigation: true }, "", path);
    }
    setPage("catalog");
    setSelected(game);
  };
  const closeGame = () => {
    setSelected(null);
    if (window.history.state?.rcfmCatalogNavigation) {
      window.history.back();
    } else {
      const targetPath = page === "catalog" ? "/catalogo" : "/";
      if (currentRoutePath() !== targetPath) {
        window.history.replaceState({}, "", targetPath);
      }
    }
  };
  const switchPage = (next: Page) => {
    const targetPath = next === "catalog" ? "/catalogo" : "/";
    if (currentRoutePath() !== targetPath) {
      window.history.pushState({}, "", targetPath);
    }
    setPage(next);
    setSelected(null);
  };

  useEffect(() => {
    const syncGameFromUrl = () => {
      const path = currentRoutePath();
      if (path === "/catalogo") {
        setSelected(null);
        setPage("catalog");
        return;
      }
      if (path === "/") {
        setSelected(null);
        setPage("home");
        return;
      }

      const game = gameGroups
        .flatMap(({ versions }) => versions)
        .find((candidate) => gameRoutePath(candidate) === path);
      if (game) {
        setPage("catalog");
        setSelected(game);
      } else if (!loading && gameGroups.length > 0) {
        window.history.replaceState({}, "", "/");
        setSelected(null);
      }
    };

    syncGameFromUrl();
    window.addEventListener("popstate", syncGameFromUrl);
    return () => window.removeEventListener("popstate", syncGameFromUrl);
  }, [gameGroups, loading]);

  useEffect(() => {
    if (featuredGamesList.length === 0 && gameGroups.length > 0) {
      const allGames = gameGroups.map(g => g.versions[0]);
      const list = allGames.filter(g => g.heroUrl);
      if (list.length === 0) {
        const fallback = allGames[0];
        setFeaturedGamesList(fallback ? [fallback] : []);
        return;
      }
      const shuffled = [...list].sort(() => 0.5 - Math.random());
      setFeaturedGamesList(shuffled.slice(0, 3));
    }
  }, [gameGroups, featuredGamesList.length]);

  const featuredGame = featuredGamesList[currentBannerIndex];

  useEffect(() => {
    if (isHoveringBanner && featuredGame?.trailerUrl) {
      setShowTrailer(true);
    } else {
      setShowTrailer(false);
    }
  }, [isHoveringBanner, currentBannerIndex, featuredGame?.trailerUrl]);

  return (
    <div className={`launcher-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="launcher-sidebar">
        <button
          className="collapse-button"
          type="button"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <div className="launcher-logo"><img src="/rcfm_sem_fundo.png" alt="RCFM" /></div>
        <nav className="launcher-nav">
          <SidebarButton icon={<Home />} label="Início" active={page === "home"} onClick={() => switchPage("home")} />
          <div className={`nav-group ${page === "catalog" || page === "library" ? "active" : ""}`}>
            <button className="sidebar-button" type="button" onClick={() => switchPage("catalog")}>
              <Library /><span>Jogos</span><ChevronDown className="dropdown-arrow" size={16} />
            </button>
            <div className="sidebar-subitems">
              <button className={page === "catalog" ? "active" : ""} type="button" onClick={() => switchPage("catalog")}>Catálogo</button>
              <button className={page === "library" ? "active" : ""} type="button" onClick={() => switchPage("library")}>Biblioteca</button>
            </div>
          </div>
          <SidebarButton icon={<Store />} label="Loja" onClick={() => setUnavailable("Loja")} />
          <SidebarButton icon={<Trophy />} label="Esports" onClick={() => setUnavailable("Esports")} />
          <SidebarButton icon={<Users />} label="Amigos" onClick={() => setUnavailable("Amigos")} />
        </nav>
        <nav className="launcher-nav bottom-nav">
          <SidebarButton icon={<Download />} label="Downloads" onClick={() => setUnavailable("Downloads")} />
          <SidebarButton icon={<Settings />} label="Configurações" onClick={() => setUnavailable("Configurações")} />
        </nav>
        <div className="web-profile">
          <div className="avatar">R</div>
          <div><b>RCFM Web</b><small><i /> Online</small></div>
        </div>
      </aside>

      <main className="launcher-main">
        {page === "home" && (
          <div className="home-container">
            {featuredGame && (
              <section 
                className="hero-banner" 
                style={{ backgroundImage: `url('${featuredGame.heroUrl || featuredGame.coverUrl}')` }}
                onMouseEnter={() => setIsHoveringBanner(true)}
                onMouseLeave={() => setIsHoveringBanner(false)}
              >
                {showTrailer && featuredGame.trailerUrl && (
                  <HlsVideoPlayer 
                    className={`hero-video ${showTrailer ? 'active' : ''}`} 
                    src={featuredGame.trailerUrl} 
                    autoPlay 
                    loop 
                    muted 
                  />
                )}

                <button className="banner-arrow left" onClick={() => setCurrentBannerIndex(prev => (prev === 0 ? featuredGamesList.length - 1 : prev - 1))}>
                  <ChevronLeft size={32} />
                </button>
                
                <div className={`hero-overlay ${showTrailer ? 'hidden' : ''}`}>
                  <div className="hero-content">
                    <span className="hero-badge">EM DESTAQUE</span>
                    <h1 className="hero-title">{featuredGame.title}</h1>
                    
                    <div className="hero-actions">
                      <button 
                        className="hero-play-btn" 
                        onClick={() => openGame(featuredGame)}
                      >
                        JOGAR AGORA
                      </button>
                      <button className="hero-more-btn">
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                  </div>
                  {/* Carousel Dots */}
                  <div className="hero-dots">
                    {featuredGamesList.map((_, idx) => (
                      <div 
                        key={idx} 
                        className={`dot ${idx === currentBannerIndex ? 'active' : ''}`}
                        onClick={() => setCurrentBannerIndex(idx)}
                      />
                    ))}
                  </div>
                </div>

                <button className="banner-arrow right" onClick={() => setCurrentBannerIndex(prev => (prev === featuredGamesList.length - 1 ? 0 : prev + 1))}>
                  <ChevronRight size={32} />
                </button>
              </section>
            )}
          </div>
        )}
        {page === "library" && <LibraryPage onBrowse={() => switchPage("catalog")} />}
        {page === "catalog" && !selected && (
          <section className="catalog-page">
            <header className="catalog-header">
              <div className="catalog-title">
                <h1>
                  JOGOS ({gameGroups.length}) - {formatBytes(
                    latestGames.reduce((total, game) => total + (game.sizeBytes || 0), 0),
                  )}
                </h1>
                <div />
              </div>
              <div className="catalog-actions">
                <label className="launcher-search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar jogos..."
                  />
                </label>
                <div className="catalog-toggles">
                  <button className="active" type="button"><Gamepad2 size={18} /></button>
                  <button type="button" onClick={() => setUnavailable("Ferramentas")}><Wrench size={18} /></button>
                  <button type="button" onClick={() => setUnavailable("Utilitários")}><Package size={18} /></button>
                </div>
              </div>
            </header>

            <div className="catalog-controls">
              <div className="catalog-filter-group">
                <span className="catalog-control-label"><SlidersHorizontal size={15} /> Filtrar</span>
                <div className="catalog-filter-options">
                  {([
                    ["all", "Todos"],
                    ["onlinefix", "OnlineFix"],
                    ["hypervisor", "Hypervisor"],
                    ["normal", "Normal"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`catalog-filter-button ${filter === value ? "active" : ""}`}
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="catalog-sort-control">
                <span className="catalog-control-label"><ArrowDownAZ size={15} /> Ordenar</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  <option value="title-asc">A–Z</option>
                  <option value="title-desc">Z–A</option>
                  <option value="onlinefix-first">OnlineFix primeiro</option>
                  <option value="hypervisor-first">Hypervisor primeiro</option>
                  <option value="normal-first">Normal primeiro</option>
                </select>
              </label>
            </div>

            <div className="catalog-content">
              {loading
                ? <div className="launcher-empty">Carregando catálogo…</div>
                : visibleGroups.length === 0
                  ? <div className="launcher-empty">Nenhum jogo encontrado.</div>
                  : (
                    <div className="launcher-grid">
                      {visibleGroups.map((group) => (
                        <GameCard
                          key={group.identity}
                          versions={group.versions}
                          onOpen={openGame}
                        />
                      ))}
                    </div>
                  )}
            </div>
          </section>
        )}
        {selected && <GameDetails game={selected} onBack={closeGame} />}
      </main>

      {unavailable && <UnavailableModal feature={unavailable} onClose={() => setUnavailable(null)} />}
    </div>
  );
}

function SidebarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`sidebar-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

function GameCard({
  versions,
  onOpen,
}: {
  versions: Game[];
  onOpen: (game: Game) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(versions.length - 1, 0)));
  }, [versions.length]);

  const game = versions[activeIndex];
  const patchClass = game.isOutdated === true
    ? "outdated"
    : game.isOutdated === false
      ? "updated"
      : "";
  const hasMultipleVersions = versions.length > 1;
  const changeVersion = (direction: -1 | 1) => {
    setActiveIndex((index) => (index + direction + versions.length) % versions.length);
  };

  return (
    <article className="launcher-game-card">
      <div className="launcher-cover">
        <span className="corner top-left" />
        <span className="corner bottom-right" />
        {game.typeck === "OnlineFix" && <em className="type-tag onlinefix">OnlineFix</em>}
        {game.typeck === "Hypervisor" && <em className="type-tag hypervisor">Hypervisor</em>}
        {game.coverUrl
          ? <img src={game.coverUrl} alt={`Capa de ${game.title}`} />
          : <div className="cover-placeholder" />}
        <div className="cover-overlay"><span>VER DETALHES</span></div>
        <button
          className="card-open-hitbox"
          type="button"
          aria-label={`Abrir ${game.title}, versão ${game.version ?? "não informada"}`}
          onClick={() => onOpen(game)}
        />
        {hasMultipleVersions && (
          <>
            <button
              className="version-arrow previous"
              type="button"
              aria-label="Versão anterior"
              title="Versão anterior"
              onClick={() => changeVersion(-1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="version-arrow next"
              type="button"
              aria-label="Próxima versão"
              title="Próxima versão"
              onClick={() => changeVersion(1)}
            >
              <ChevronRight size={20} />
            </button>
            <span className="version-counter">{activeIndex + 1}/{versions.length}</span>
          </>
        )}
        {game.sizeBytes && <b className="size-tag">{formatBytes(game.sizeBytes)}</b>}
      </div>
      <button className="card-info card-info-button" type="button" onClick={() => onOpen(game)}>
        <h3>{game.title}</h3>
        <p>
          <span>Disponível</span>
          {game.version && <><i>•</i>{game.version}</>}
          {game.patch && <><i>•</i><b className={`patch-status ${patchClass}`}>{game.patch}</b></>}
        </p>
        {game.genres && <small>{game.genres}</small>}
      </button>
    </article>
  );
}

function GameDetails({ game, onBack }: { game: Game; onBack: () => void }) {
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started" | "error">("idle");
  const [downloadMessage, setDownloadMessage] = useState("");
  const patchClass = game.isOutdated === true
    ? "outdated"
    : game.isOutdated === false
      ? "updated"
      : "";
  const startDownload = async () => {
    if (!game.installerUrl || downloadState === "preparing") return;
    setDownloadState("preparing");
    setDownloadMessage("Resolvendo o link e preparando o instalador...");

    try {
      let downloadUrl = game.installerUrl;
      if (isMediaFireLink(downloadUrl)) {
        const response = await fetch(
          `/api/mediafire-download?format=json&url=${encodeURIComponent(downloadUrl)}`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          throw new Error((await response.text()) || "Não foi possível preparar o download.");
        }
        const payload = await response.json() as { downloadUrl?: unknown };
        if (typeof payload.downloadUrl !== "string" || !isMediaFireLink(payload.downloadUrl)) {
          throw new Error("O servidor retornou um link de download inválido.");
        }
        downloadUrl = payload.downloadUrl;
      }

      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setDownloadState("started");
      setDownloadMessage("Download iniciado. Confira os downloads do navegador.");
      window.setTimeout(() => {
        setDownloadState("idle");
        setDownloadMessage("");
      }, 5000);
    } catch (reason) {
      setDownloadState("error");
      setDownloadMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="web-game-page">
      <div
        className="web-game-background"
        style={game.heroUrl ? { backgroundImage: `url(${game.heroUrl})` } : undefined}
      >
        <div />
      </div>
      <div className="web-game-content">
        <div className="web-game-main-view">
          <button className="nav-back-btn" type="button" onClick={onBack}>
            <ArrowLeft size={20} /><span>Voltar</span>
          </button>
          <div className="web-game-details-section">
            <div className="web-game-title-area">
              {game.typeck !== "Nenhum" && (
                <span className={`web-game-tag ${game.typeck.toLowerCase()}`}>
                  {game.typeck.toUpperCase()}
                </span>
              )}
              <h1 className="web-game-massive-title">{game.title}</h1>
              <div className="web-game-meta-row">
                {game.version && <span className="web-meta-badge">Versão: {game.version}</span>}
                {game.patch && (
                  <span className="web-meta-badge">
                    Patch: <strong className={`patch-status ${patchClass}`}>{game.patch}</strong>
                  </span>
                )}
                {game.sizeBytes && <span className="web-meta-badge">Tamanho: {formatBytes(game.sizeBytes)}</span>}
              </div>
            </div>
            <div className="web-game-action-area">
              {game.installerUrl
                ? (
                  <button
                    className={`web-primary-action-btn ${downloadState === "preparing" ? "is-loading" : ""}`}
                    type="button"
                    onClick={() => void startDownload()}
                    disabled={downloadState === "preparing"}
                  >
                    {downloadState === "preparing"
                      ? <LoaderCircle className="download-spinner" size={18} />
                      : <Download size={18} />}
                    {downloadState === "preparing" ? "PREPARANDO..." : "BAIXAR INSTALADOR"}
                  </button>
                )
                : <div className="installer-pending">Instalador portátil ainda não publicado para esta versão.</div>}
              {downloadState !== "idle" && (
                <div className={`download-feedback ${downloadState}`} role="status" aria-live="polite">
                  {downloadState === "preparing" && <LoaderCircle className="download-spinner" size={20} />}
                  {downloadState === "started" && <CheckCircle2 size={20} />}
                  <span>{downloadMessage}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LibraryPage({ onBrowse }: { onBrowse: () => void }) {
  return (
    <section className="library-page">
      <h1>Minha Biblioteca</h1>
      <p>Jogos instalados no seu computador aparecem no RCFM Launcher para Windows.</p>
      <div className="library-empty">
        <Download size={58} />
        <h2>Nenhum jogo encontrado!</h2>
        <p>O navegador não acessa suas pastas locais. Abra o launcher para consultar sua biblioteca instalada.</p>
        <button type="button" onClick={onBrowse}>Visitar catálogo</button>
      </div>
    </section>
  );
}

function UnavailableModal({ feature, onClose }: { feature: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="unavailable-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon">!</div>
        <h2>Funcionalidade indisponível no site</h2>
        <p>{feature} funciona somente no RCFM Launcher para Windows.</p>
        <button type="button" onClick={onClose}>Entendi</button>
      </section>
    </div>
  );
}
