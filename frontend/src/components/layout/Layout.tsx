import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar';
import Header from './Header';
import { usePlant } from '../../context/PlantContext';
import { settingsApi } from '../../services/api';
import type { Plant } from '../../types';

export default function Layout() {
  const { setPlants } = usePlant();

  const { data } = useQuery({
    queryKey: ['plants'],
    queryFn: () => settingsApi.getPlants().then((r) => r.data),
  });

  useEffect(() => {
    if (data?.plants) setPlants(data.plants as Plant[]);
  }, [data, setPlants]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
