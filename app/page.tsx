"use client";

import { collectionGroup, onSnapshot } from "firebase/firestore";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  Play,
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
  installedDlcs?: string[];
  missingDlcs?: string[];
  typeck: "OnlineFix" | "Hypervisor" | "Nenhum";
  installerUrl?: string;
  trailerUrl?: string;
  developer?: string;
  publisher?: string;
  releaseDate?: string;
  shortDescription?: string;
  screenshots?: string[];
  trailers?: string[];
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
  const [overlayVisible, setOverlayVisible] = useState(true);
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
            developer: typeof data.developer === "string" ? data.developer : undefined,
            publisher: typeof data.publisher === "string" ? data.publisher : undefined,
            releaseDate: typeof data.releaseDate === "string" ? data.releaseDate : undefined,
            shortDescription: typeof data.shortDescription === "string" ? data.shortDescription : undefined,
            screenshots: Array.isArray(data.screenshots) ? data.screenshots.filter((s: unknown): s is string => typeof s === "string") : undefined,
            trailers: Array.isArray(data.trailers) ? data.trailers.filter((t: unknown): t is string => typeof t === "string") : undefined,
            installedDlcs: Array.isArray(data.installedDlcs) ? data.installedDlcs.filter((s: unknown): s is string => typeof s === "string") : undefined,
            missingDlcs: Array.isArray(data.missingDlcs) ? data.missingDlcs.filter((s: unknown): s is string => typeof s === "string") : undefined,
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
      const targetPath = page === "catalog" ? "/catalogo" : "/home";
      if (currentRoutePath() !== targetPath) {
        window.history.replaceState({}, "", targetPath);
      }
    }
  };
  const switchPage = (next: Page) => {
    const targetPath = next === "catalog" ? "/catalogo" : "/home";
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
      if (path === "/" || path === "/home") {
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
        window.history.replaceState({}, "", "/home");
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
      setOverlayVisible(false);
    } else {
      setShowTrailer(false);
      setOverlayVisible(true);
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
                onClick={() => setOverlayVisible(prev => !prev)}
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

                <button className="banner-arrow left" onClick={(e) => { e.stopPropagation(); setCurrentBannerIndex(prev => (prev === 0 ? featuredGamesList.length - 1 : prev - 1)); }}>
                  <ChevronLeft size={32} />
                </button>
                
                <div className={`hero-overlay ${!overlayVisible ? 'hidden' : ''}`}>
                  <div className="hero-content">
                    <span className="hero-badge">EM DESTAQUE</span>
                    <h1 className="hero-title">{featuredGame.title}</h1>
                    
                    <div className="hero-actions">
                      <button 
                        className="hero-play-btn" 
                        onClick={(e) => { e.stopPropagation(); openGame(featuredGame); }}
                      >
                        JOGAR AGORA
                      </button>
                      <button className="hero-more-btn" onClick={(e) => e.stopPropagation()}>
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
                        onClick={(e) => { e.stopPropagation(); setCurrentBannerIndex(idx); }}
                      />
                    ))}
                  </div>
                </div>

                <button className="banner-arrow right" onClick={(e) => { e.stopPropagation(); setCurrentBannerIndex(prev => (prev === featuredGamesList.length - 1 ? 0 : prev + 1)); }}>
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

  const isInstalledEmpty = !game.installedDlcs?.length || (game.installedDlcs.length === 1 && game.installedDlcs[0] === '0');
  const isMissingEmpty = !game.missingDlcs?.length || (game.missingDlcs.length === 1 && game.missingDlcs[0] === '0');
  const hasDlcData = !isInstalledEmpty || !isMissingEmpty;

  const sortedInstalledDlcs = game.installedDlcs ? [...game.installedDlcs].sort((a, b) => a.localeCompare(b)) : [];
  const sortedMissingDlcs = game.missingDlcs ? [...game.missingDlcs].sort((a, b) => a.localeCompare(b)) : [];

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
      <div className="card-info" onClick={() => onOpen(game)}>
        <h3>{game.title}</h3>
        <p>
          {game.version && <span>{game.version}</span>}
          {game.version && game.patch && <i>•</i>}
          {game.patch && <span>Patch: <b className={`patch-status ${patchClass}`}>{game.patch}</b></span>}
        </p>
        {game.genres && <small>{game.genres}</small>}
        
        <div className="dlc-badges-container">
          {!hasDlcData ? (
            <div className="dlc-badge all-included">
              Sem DLCs
            </div>
          ) : (
            <>
              {!isInstalledEmpty && game.installedDlcs && (
                <div className="dlc-badge installed">
                  {game.installedDlcs.length} Inclusas
                  <div className="dlc-tooltip">
                    <div className="dlc-tooltip-header">DLCs Inclusas</div>
                    <ul>
                      {sortedInstalledDlcs.map((dlc, i) => <li key={i}>{dlc}</li>)}
                    </ul>
                  </div>
                </div>
              )}
              {isMissingEmpty ? (
                <div className="dlc-badge all-included">
                  Nenhuma Faltando
                </div>
              ) : game.missingDlcs && (
                <div className="dlc-badge missing">
                  {game.missingDlcs.length} Faltando
                  <div className="dlc-tooltip">
                    <div className="dlc-tooltip-header">DLCs Faltantes</div>
                    <ul>
                      {sortedMissingDlcs.map((dlc, i) => <li key={i}>{dlc}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function GameDetails({ game, onBack }: { game: Game; onBack: () => void }) {
  const [downloadState, setDownloadState] = useState<"idle" | "preparing" | "started" | "error">("idle");
  const [downloadMessage, setDownloadMessage] = useState("");
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
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

  const backgroundUrl = game.heroUrl || game.coverUrl || "";

  const mediaItems: { type: "video" | "image"; url: string; thumbnail: string }[] = [];
  if (game.trailers && game.trailers.length > 0) {
    game.trailers.forEach(t => mediaItems.push({ type: "video", url: t, thumbnail: backgroundUrl }));
  } else if (game.trailerUrl) {
    mediaItems.push({ type: "video", url: game.trailerUrl, thumbnail: backgroundUrl });
  }
  if (game.screenshots && game.screenshots.length > 0) {
    game.screenshots.forEach(s => mediaItems.push({ type: "image", url: s, thumbnail: s }));
  }

  const selectedMedia = mediaItems[selectedMediaIndex] || { type: "image" as const, url: backgroundUrl, thumbnail: backgroundUrl };

  const scrollCarousel = (dir: "left" | "right") => {
    if (carouselRef.current) {
      carouselRef.current.scrollBy({ left: dir === "left" ? -300 : 300, behavior: "smooth" });
    }
  };

  return (
    <section className="web-game-page">
      <div
        className="web-game-background"
        style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}
      >
        <div />
      </div>
      <div className="web-game-content">
        <div className="web-game-main-view" style={{ justifyContent: "flex-start", paddingTop: "100px" }}>
          <button className="nav-back-btn" type="button" onClick={onBack}>
            <ArrowLeft size={20} /><span>Voltar</span>
          </button>

          <div className="web-steam-game-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 className="web-steam-game-title" style={{ textAlign: 'center' }}>{game.title}</h1>
            <div className="web-game-meta-row" style={{ justifyContent: "center", marginTop: "8px" }}>
              {game.version && <span className="web-meta-badge">Versão: {game.version}</span>}
              {game.patch && (
                <span className="web-meta-badge">
                  Patch: <strong className={`patch-status ${patchClass}`}>{game.patch}</strong>
                </span>
              )}
              {game.sizeBytes && <span className="web-meta-badge">Tamanho: {formatBytes(game.sizeBytes)}</span>}
            </div>
          </div>

          <div className="web-steam-main-grid" style={{ position: 'relative' }}>
            {/* DLC Wing - Left */}
            <details open className="steam-dlc-section" style={{ position: 'absolute', top: 0, right: '100%', marginRight: '20px', width: '340px', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#6ee7a0', outline: 'none', userSelect: 'none', fontSize: '20px' }}>DLCs Ativas ({game.installedDlcs?.length || 0})</summary>
              <ul style={{ marginTop: '24px', paddingLeft: '24px', color: '#c6d4df', fontSize: '18px', listStyleType: 'disc' }}>
                {(game.installedDlcs || []).map(dlc => <li key={dlc} style={{ marginBottom: '40px', lineHeight: '1.4', fontWeight: 'bold' }}>{dlc}</li>)}
              </ul>
            </details>

            {/* DLC Wing - Right */}
            <details open className="steam-dlc-section" style={{ position: 'absolute', top: 0, left: '100%', marginLeft: '20px', width: '340px', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '20px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ff8f8f', outline: 'none', userSelect: 'none', fontSize: '20px' }}>DLCs Faltantes ({game.missingDlcs?.length || 0})</summary>
              <ul style={{ marginTop: '24px', paddingLeft: '24px', color: '#c6d4df', fontSize: '18px', listStyleType: 'disc' }}>
                {(game.missingDlcs || []).map(dlc => <li key={dlc} style={{ marginBottom: '40px', lineHeight: '1.4', fontWeight: 'bold' }}>{dlc}</li>)}
              </ul>
            </details>

            <div className="web-steam-left-col">
              <div className="web-steam-media-player">
                {selectedMedia.type === "video" ? (
                  <HlsVideoPlayer
                    key={selectedMedia.url}
                    className="web-steam-video"
                    src={selectedMedia.url}
                    autoPlay
                    loop
                    muted
                  />
                ) : (
                  <img src={selectedMedia.url} className="web-steam-video-fallback" alt="Media" />
                )}
              </div>

              {mediaItems.length > 1 && (
                <div className="web-steam-carousel-wrapper">
                  <button className="web-steam-carousel-btn" type="button" onClick={() => scrollCarousel("left")}>
                    <ChevronLeft size={24} />
                  </button>
                  <div className="web-steam-carousel-thumbnails" ref={carouselRef}>
                    {mediaItems.map((item, i) => (
                      <div
                        key={i}
                        className={`web-steam-thumbnail ${i === selectedMediaIndex ? "active" : ""}`}
                        onClick={() => setSelectedMediaIndex(i)}
                      >
                        <img src={item.thumbnail} alt={`Thumbnail ${i}`} />
                        {item.type === "video" && (
                          <div className="web-steam-thumbnail-play">
                            <Play size={16} fill="currentColor" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button className="web-steam-carousel-btn" type="button" onClick={() => scrollCarousel("right")}>
                    <ChevronRight size={24} />
                  </button>
                </div>
              )}
            </div>

            <div className="web-steam-right-col">
              <img src={backgroundUrl} className="web-steam-cover-img" alt={game.title} />

              <p className="web-steam-description">
                {game.shortDescription || "Sem descrição disponível."}
              </p>

              <div className="web-steam-metadata">
                <div className="web-steam-meta-row">
                  <span className="web-steam-meta-label">DATA DE LANÇAMENTO:</span>
                  <span className="web-steam-meta-value">{game.releaseDate || "—"}</span>
                </div>
                <div className="web-steam-meta-row">
                  <span className="web-steam-meta-label">DESENVOLVEDOR:</span>
                  <span className="web-steam-meta-value">{game.developer || "Desconhecido"}</span>
                </div>
                <div className="web-steam-meta-row">
                  <span className="web-steam-meta-label">DISTRIBUIDORA:</span>
                  <span className="web-steam-meta-value">{game.publisher || "Desconhecida"}</span>
                </div>
              </div>

              <div className="web-steam-tags-container">
                <span className="web-steam-meta-label-small">Marcadores populares para este produto:</span>
                <div className="web-steam-tags">
                  {game.typeck !== "Nenhum" && (
                    <span
                      className="web-steam-tag"
                      style={game.typeck === "OnlineFix" ? { backgroundColor: "#000", color: "#fff" } : { backgroundColor: "#fff", color: "#000" }}
                    >
                      {game.typeck.toUpperCase()}
                    </span>
                  )}
                  {game.genres && game.genres.split(",").map(tag => (
                    <span key={tag} className="web-steam-tag">{tag.trim()}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Download Action Area */}
          <div className="web-steam-action-area">
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
