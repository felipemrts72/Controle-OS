import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import './SectorTvPage.css';

function formatDate(date) {
  return new Date(date).toLocaleDateString('pt-BR');
}

function formatTaskTitle(task) {
  return `${task.quantity} - ${task.task_name}`.toUpperCase();
}

export function SectorTvPage() {
  const { setorSlug } = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [selectedSectorSlug, setSelectedSectorSlug] = useState(null);
  const [isSectorMenuOpen, setIsSectorMenuOpen] = useState(false);
  const selectorRef = useRef(null);

  const sectors = useMemo(() => {
    const sectorsBySlug = new Map();
    tasks.forEach((task) => {
      sectorsBySlug.set(task.sector_slug, { slug: task.sector_slug, name: task.sector_name });
    });
    return [...sectorsBySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const selectedSector = sectors.find((sector) => sector.slug === selectedSectorSlug);
  const visibleTasks = selectedSectorSlug
    ? tasks.filter((task) => task.sector_slug === selectedSectorSlug)
    : tasks;

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await api.get(setorSlug ? `/tv/${setorSlug}` : '/tv');
      if (active) setTasks(response.data);
    }
    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [setorSlug]);

  useEffect(() => {
    if (selectedSectorSlug && !sectors.some((sector) => sector.slug === selectedSectorSlug)) {
      setSelectedSectorSlug(null);
    }
  }, [sectors, selectedSectorSlug]);

  useEffect(() => {
    function closeMenu(event) {
      if (selectorRef.current && !selectorRef.current.contains(event.target)) {
        setIsSectorMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') navigate('/dashboard');
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  function selectSector(slug) {
    setSelectedSectorSlug(slug);
    setIsSectorMenuOpen(false);
  }

  return (
    <main className="sector-tv-page">
      <header className="sector-tv-page__header">
        <div className="sector-tv-page__selector" ref={selectorRef}>
          <h1>
            <button className="sector-tv-page__title-button" type="button" onClick={() => setIsSectorMenuOpen((current) => !current)}>
              {setorSlug ? `TV ${setorSlug}` : selectedSector?.name || 'SERVIÇOS'}
            </button>
          </h1>
          {!setorSlug && isSectorMenuOpen && (
            <div className="sector-tv-page__menu">
              <button type="button" onClick={() => selectSector(null)}>SERVIÇOS</button>
              {sectors.map((sector) => (
                <button key={sector.slug} type="button" onClick={() => selectSector(sector.slug)}>{sector.name}</button>
              ))}
            </div>
          )}
        </div>
        <span>Atualização automática a cada 10 segundos</span>
      </header>

      {visibleTasks.length === 0 ? (
        <p className="sector-tv-page__empty">Nenhuma tarefa pendente.</p>
      ) : (
        <div className="sector-tv-page__cards">
          {visibleTasks.map((task) => (
            <article className={`sector-tv-page__card ${task.is_late ? 'sector-tv-page__card_late' : 'sector-tv-page__card_on-time'}`} key={task.task_id}>
              <strong className="sector-tv-page__task-title">{formatTaskTitle(task)}</strong>
              <div className="sector-tv-page__meta">
                <span>Venda: {task.sale_number}</span>
                <span>{task.customer_name}</span>
                <span>Entrega: {formatDate(task.promised_date)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
