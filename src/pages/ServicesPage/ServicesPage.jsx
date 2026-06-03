import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import './ServicesPage.css';

function formatDate(date) {
  return new Date(date).toLocaleDateString('pt-BR');
}

function formatStatus(status) {
  return status === 'ready' ? 'Pronta' : 'Pendente';
}

export function ServicesPage() {
  const user = getStoredUser();
  const canMarkReady = ['admin', 'manager'].includes(user?.role);
  const [orders, setOrders] = useState([]);
  const [selectedSectorSlug, setSelectedSectorSlug] = useState(null);
  const [isSectorMenuOpen, setIsSectorMenuOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState(null);
  const [error, setError] = useState('');
  const selectorRef = useRef(null);

  const sectors = useMemo(() => {
    const sectorsBySlug = new Map();
    orders.forEach((order) => {
      order.tasks.forEach((task) => {
        sectorsBySlug.set(task.sector_slug, { slug: task.sector_slug, name: task.sector_name });
      });
    });
    return [...sectorsBySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  const selectedSector = sectors.find((sector) => sector.slug === selectedSectorSlug);
  const filteredOrders = useMemo(() => {
    return orders
      .map((order) => {
        if (!selectedSectorSlug) return order;
        const tasks = order.tasks.filter((task) => task.sector_slug === selectedSectorSlug);
        return {
          ...order,
          tasks,
          pending_tasks_count: tasks.filter((task) => task.status === 'pending').length,
          ready_tasks_count: tasks.filter((task) => task.status === 'ready').length,
        };
      })
      .filter((order) => order.tasks.length > 0 && order.pending_tasks_count > 0);
  }, [orders, selectedSectorSlug]);

  const selectedOrder = selectedOrderId
    ? orders.find((order) => order.internal_order_id === selectedOrderId)
    : null;

  async function loadServices() {
    const response = await api.get('/services');
    setOrders(response.data);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setError('');
        const response = await api.get('/services');
        if (active) setOrders(response.data);
      } catch {
        if (active) setError('Não foi possível carregar os serviços.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

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

  function selectSector(slug) {
    setSelectedSectorSlug(slug);
    setIsSectorMenuOpen(false);
  }

  async function markTaskReady(taskId) {
    try {
      setSavingTaskId(taskId);
      setError('');
      await api.patch(`/tasks/${taskId}/ready`);
      await loadServices();
    } catch {
      setError('Não foi possível marcar a tarefa como pronta.');
    } finally {
      setSavingTaskId(null);
    }
  }

  return (
    <section className="services-page">
      <header className="services-page__header">
        <div className="services-page__selector" ref={selectorRef}>
          <h1>
            <button
              className="services-page__title-button"
              type="button"
              onClick={() => setIsSectorMenuOpen((current) => !current)}
            >
              {selectedSector ? selectedSector.name : 'SERVIÇOS'}
            </button>
          </h1>
          {isSectorMenuOpen && (
            <div className="services-page__menu">
              <button type="button" onClick={() => selectSector(null)}>SERVIÇOS</button>
              {sectors.map((sector) => (
                <button key={sector.slug} type="button" onClick={() => selectSector(sector.slug)}>
                  {sector.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {error && <p className="services-page__error">{error}</p>}
      {isLoading && <p className="services-page__empty">Carregando serviços...</p>}

      {!isLoading && (
        <div className="services-page__cards">
          {filteredOrders.length === 0 && (
            <p className="services-page__empty">Nenhuma tarefa pendente.</p>
          )}

          {filteredOrders.map((order) => (
            <button
              className="services-page__order-card"
              key={order.internal_order_id}
              type="button"
              onClick={() => setSelectedOrderId(order.internal_order_id)}
            >
              <div>
                <span>Número da venda</span>
                <strong>{order.sale_number}</strong>
              </div>
              <div>
                <span>Cliente</span>
                <strong>{order.customer_name}</strong>
              </div>
              <div>
                <span>Data de entrega</span>
                <strong>{formatDate(order.promised_date)}</strong>
              </div>
              <div>
                <span>Pendentes</span>
                <strong>{order.pending_tasks_count}</strong>
              </div>
              <div>
                <span>Prontas</span>
                <strong>{order.ready_tasks_count}</strong>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedOrder && (
        <div className="services-page__modal">
          <div className="services-page__modal-content">
            <div className="services-page__modal-header">
              <div>
                <h2>Venda {selectedOrder.sale_number}</h2>
                <p>{selectedOrder.customer_name} · Entrega {formatDate(selectedOrder.promised_date)}</p>
              </div>
              <button className="button" type="button" onClick={() => setSelectedOrderId(null)}>Fechar</button>
            </div>

            <div className="services-page__task-list">
              {selectedOrder.tasks.map((task) => (
                <article className="services-page__task" key={task.task_id}>
                  <div>
                    <span>Quantidade</span>
                    <strong>{task.quantity}</strong>
                  </div>
                  <div>
                    <span>Nome da tarefa</span>
                    <strong>{task.task_name}</strong>
                  </div>
                  <div>
                    <span>Setor</span>
                    <strong>{task.sector_name}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{formatStatus(task.status)}</strong>
                  </div>
                  {canMarkReady && task.status === 'pending' && (
                    <button
                      className="button button_primary"
                      type="button"
                      onClick={() => markTaskReady(task.task_id)}
                      disabled={savingTaskId === task.task_id}
                    >
                      {savingTaskId === task.task_id ? 'Salvando...' : 'Pronto'}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
