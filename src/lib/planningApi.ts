import axios from 'axios';
import { db } from './db';
import type { PlanningRevision, PlanningScenario, PlanningTemplate } from './planning';

const retryable = (error: unknown) => axios.isAxiosError(error)
  && (!error.response || error.response.status === 429 || error.response.status >= 500);

export const PlanningAPI = {
  async list(authorized = false): Promise<Array<PlanningScenario & { publishedRevision?: number | null }>> {
    const pending = authorized
      ? await db.planningScenarios.filter(scenario => scenario.syncStatus?.startsWith('pending_') ?? false).toArray()
      : [];
    if (navigator.onLine) {
      try {
        const response = await axios.get('/api/planning/scenarios');
        const pendingIds = new Set(pending.map(scenario => scenario.id));
        const server = (response.data as PlanningScenario[]).filter(scenario => !pendingIds.has(scenario.id));
        if (authorized) {
          const serverIds = new Set(server.map(scenario => scenario.id));
          const stale = (await db.planningScenarios.toArray())
            .filter(scenario => !scenario.syncStatus?.startsWith('pending_') && !serverIds.has(scenario.id))
            .map(scenario => scenario.id);
          if (stale.length) await db.planningScenarios.bulkDelete(stale);
        }
        await db.planningScenarios.bulkPut(server.map(scenario => ({ ...scenario, syncStatus: 'synced' })));
        return [...server, ...pending.filter(scenario => scenario.syncStatus !== 'pending_delete')];
      } catch {
        // The saved offline list remains useful when the server is unavailable.
      }
    }
    return (await db.planningScenarios.toArray()).filter(scenario => scenario.syncStatus !== 'pending_delete'
      && (authorized || (scenario.classification === 'Public' && Boolean(scenario.publishedRevision))));
  },

  async create(scenario: PlanningScenario) {
    if (navigator.onLine) {
      try {
        const response = await axios.post('/api/planning/scenarios', scenario);
        await db.planningScenarios.put({ ...response.data, syncStatus: 'synced' });
        return response.data as PlanningScenario;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409) {
          const response = await axios.get(`/api/planning/scenarios/${scenario.id}`);
          await db.planningScenarios.put({ ...response.data, syncStatus: 'synced' });
          return response.data as PlanningScenario;
        }
        if (!retryable(error)) throw error;
      }
    }
    const local = { ...scenario, updatedAt: new Date().toISOString(), syncStatus: 'pending_add' } as const;
    await db.planningScenarios.put(local);
    return local;
  },

  async save(scenario: PlanningScenario, sessionId?: string): Promise<{ scenario: PlanningScenario; conflicted: boolean }> {
    if (navigator.onLine) {
      try {
        const response = await axios.put(`/api/planning/scenarios/${scenario.id}`, scenario, { headers: { 'X-Planning-Session': sessionId ?? '' } });
        await db.planningScenarios.put({ ...response.data, syncStatus: 'synced' });
        return { scenario: response.data, conflicted: false };
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409 && error.response.data?.current) {
          const conflict = {
            ...scenario,
            id: crypto.randomUUID(),
            name: `${scenario.name} (offline conflict)`,
            draftVersion: 0,
            updatedAt: new Date().toISOString(),
          };
          const saved = await this.create(conflict);
          await db.planningScenarios.delete(scenario.id);
          return { scenario: saved, conflicted: true };
        }
        if (!retryable(error)) throw error;
      }
    }
    const local = { ...scenario, updatedAt: new Date().toISOString(), syncStatus: scenario.draftVersion === 0 ? 'pending_add' : 'pending_update' } as const;
    await db.planningScenarios.put(local);
    return { scenario: local, conflicted: false };
  },

  async remove(scenario: PlanningScenario, sessionId?: string) {
    if (navigator.onLine) {
      try {
        await axios.delete(`/api/planning/scenarios/${scenario.id}`, { headers: { 'X-Planning-Session': sessionId ?? '' }, data: { name: scenario.name } });
        await db.planningScenarios.delete(scenario.id);
        return;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          await db.planningScenarios.delete(scenario.id);
          return;
        }
        if (!retryable(error)) throw error;
      }
    }
    await db.planningScenarios.put({ ...scenario, syncStatus: 'pending_delete' });
  },

  async publish(id: string, sessionId?: string): Promise<PlanningRevision & { warnings: string[] }> {
    if (!navigator.onLine) throw new Error('Publishing requires an internet connection');
    const response = await axios.post(`/api/planning/scenarios/${id}/publish`, {}, { headers: { 'X-Planning-Session': sessionId ?? '' } });
    await db.planningRevisions.put(response.data);
    return response.data;
  },

  async revisions(id: string, authorized = false): Promise<PlanningRevision[]> {
    if (navigator.onLine) {
      const response = await axios.get(`/api/planning/scenarios/${id}/revisions`);
      await db.planningRevisions.bulkPut(response.data);
      return response.data;
    }
    const revisions = await db.planningRevisions.where('scenarioId').equals(id).reverse().sortBy('revision');
    return authorized ? revisions : revisions.filter(revision => revision.snapshot.classification === 'Public');
  },

  async acquireLock(id: string, sessionId: string, force = false) {
    const response = await axios.post(`/api/planning/scenarios/${id}/lock`, { sessionId, force });
    return response.data as { sessionId: string; expiresAt: number };
  },

  async releaseLock(id: string, sessionId: string, force = false) {
    await axios.delete(`/api/planning/scenarios/${id}/lock`, { data: { sessionId, force } });
  },

  async preview(scenario: PlanningScenario, sessionId: string) {
    await axios.put(`/api/planning/scenarios/${scenario.id}/preview`, scenario, {
      headers: { 'X-Planning-Session': sessionId },
    });
  },

  subscribe(id: string, onEvent: (event: MessageEvent) => void) {
    const stream = new EventSource(`/api/planning/scenarios/${id}/events`);
    ['snapshot', 'preview', 'saved', 'published', 'deleted', 'lock'].forEach(type => stream.addEventListener(type, onEvent));
    return () => stream.close();
  },

  async templates(authorized = false): Promise<PlanningTemplate[]> {
    if (!authorized) return [];
    if (navigator.onLine) {
      try {
        const response = await axios.get('/api/planning/templates');
        await db.planningTemplates.bulkPut(response.data.map((template: PlanningTemplate) => ({ ...template, syncStatus: 'synced' })));
        return response.data;
      } catch {
        // Fall through to the cached library.
      }
    }
    return (await db.planningTemplates.toArray()).filter(template => template.syncStatus !== 'pending_delete');
  },

  async saveTemplate(template: PlanningTemplate) {
    if (navigator.onLine) {
      try {
        const response = await axios.put(`/api/planning/templates/${template.id}`, template);
        await db.planningTemplates.put({ ...response.data, syncStatus: 'synced' });
        return response.data as PlanningTemplate;
      } catch (error) {
        if (!retryable(error)) throw error;
      }
    }
    await db.planningTemplates.put({ ...template, syncStatus: 'pending_update' });
    return template;
  },

  async deleteTemplate(id: string) {
    const template = await db.planningTemplates.get(id);
    if (navigator.onLine) {
      try {
        await axios.delete(`/api/planning/templates/${id}`);
        await db.planningTemplates.delete(id);
        return;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          await db.planningTemplates.delete(id);
          return;
        }
        if (!retryable(error)) throw error;
      }
    }
    if (template) await db.planningTemplates.put({ ...template, syncStatus: 'pending_delete' });
  },

  async syncPending(sessionId: string = crypto.randomUUID()) {
    if (!navigator.onLine) return;
    const pending = await db.planningScenarios.filter(scenario => scenario.syncStatus?.startsWith('pending_') ?? false).toArray();
    for (const scenario of pending) {
      if (scenario.syncStatus === 'pending_delete') {
        try { await this.acquireLock(scenario.id, sessionId); await this.remove(scenario, sessionId); } catch { /* retry on the next online event */ }
      } else if (scenario.syncStatus === 'pending_add') {
        try { await this.create(scenario); } catch { /* retry on the next online event */ }
      } else {
        try { await this.acquireLock(scenario.id, sessionId); await this.save(scenario, sessionId); } catch { /* retry on the next online event */ }
      }
    }
    const templates = await db.planningTemplates.filter(template => template.syncStatus?.startsWith('pending_') ?? false).toArray();
    for (const template of templates) {
      try {
        if (template.syncStatus === 'pending_delete') await this.deleteTemplate(template.id);
        else await this.saveTemplate(template);
      } catch { /* retry on the next online event */ }
    }
  },
};
