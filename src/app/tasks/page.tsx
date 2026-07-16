'use client';

import { useState, useEffect } from 'react';
import KanbanBoard from '@/components/KanbanBoard';

interface TaskProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  boards: any[];
}

export default function TasksPage() {
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setProjects(data);
      if (data.length > 0) {
        setSelectedProject(data[0].id);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });
      const newProject = await res.json();
      setProjects([...projects, newProject]);
      setSelectedProject(newProject.id);
      setNewProjectName('');
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  if (loading) {
    return <div className="p-8">Loading task manager...</div>;
  }

  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="p-8 bg-gradient-to-br from-slate-50 to-slate-100 min-h-screen">
      <div className="max-w-full">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900">📋 Task Manager</h1>
          <div className="flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="New project name..."
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleCreateProject}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              + New
            </button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="mb-6 flex gap-2 flex-wrap">
            {projects.map(project => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project.id)}
                className={`px-4 py-2 rounded-lg font-semibold transition ${selectedProject === project.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 border border-slate-300 hover:border-blue-400'}`}
              >
                {project.icon || '📋'} {project.name}
              </button>
            ))}
          </div>
        )}

        {currentProject && (
          <KanbanBoard project={currentProject} onUpdate={fetchProjects} />
        )}

        {projects.length === 0 && !loading && (
          <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
            <p className="text-slate-600">No projects yet. Create one to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
