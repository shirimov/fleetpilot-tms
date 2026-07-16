'use client';

import { useState, useEffect } from 'react';
import TaskListView from '@/components/TaskListView';

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
  const [employees, setEmployees] = useState<any[]>([]);

  useEffect(() => {
    fetchProjects();
    fetchEmployees();
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

  const fetchEmployees = async () => {
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      setEmployees(data || []);
    } catch (error) {
      console.error('Failed to fetch employees:', error);
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
    <div className="p-8 bg-gray-950 text-white min-h-screen">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">📋 Task Manager</h1>
          <div className="flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
              placeholder="New project name..."
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleCreateProject}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
            >
              + New Project
            </button>
          </div>
        </div>

        {projects.length > 0 && (
          <div className="mb-6 flex gap-2 flex-wrap">
            {projects.map(project => (
              <button
                key={project.id}
                onClick={() => setSelectedProject(project.id)}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  selectedProject === project.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-blue-500'
                }`}
              >
                {project.icon || '📋'} {project.name}
              </button>
            ))}
          </div>
        )}

        {currentProject && (
          <TaskListView project={currentProject} employees={employees} onUpdate={fetchProjects} />
        )}

        {projects.length === 0 && !loading && (
          <div className="text-center py-12 bg-gray-800 rounded-lg border border-gray-700">
            <p className="text-gray-400">No projects yet. Create one to get started!</p>
          </div>
        )}
      </div>
    </div>
  );
}
