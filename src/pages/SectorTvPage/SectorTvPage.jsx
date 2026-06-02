import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { SectorBoard } from '../../components/SectorBoard/SectorBoard.jsx';
import './SectorTvPage.css';

export function SectorTvPage() {
  const { setorSlug } = useParams();
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await api.get(`/tv/${setorSlug}`);
      if (active) setTasks(response.data);
    }
    load();
    const timer = window.setInterval(load, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [setorSlug]);

  return (
    <main className="sector-tv-page">
      <header className="sector-tv-page__header">
        <h1>TV {setorSlug}</h1>
        <span>Atualização automática a cada 10 segundos</span>
      </header>
      <SectorBoard tasks={tasks} />
    </main>
  );
}
