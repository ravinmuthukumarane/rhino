import { createContext, useContext, useState, ReactNode } from 'react';
import type { Plant } from '../types';

interface PlantContextValue {
  selectedPlantId: string | null;
  setSelectedPlantId: (id: string | null) => void;
  plants: Plant[];
  setPlants: (plants: Plant[]) => void;
}

const PlantContext = createContext<PlantContextValue | null>(null);

export function PlantProvider({ children }: { children: ReactNode }) {
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [plants, setPlants] = useState<Plant[]>([]);

  return (
    <PlantContext.Provider value={{ selectedPlantId, setSelectedPlantId, plants, setPlants }}>
      {children}
    </PlantContext.Provider>
  );
}

export const usePlant = () => {
  const ctx = useContext(PlantContext);
  if (!ctx) throw new Error('usePlant must be inside PlantProvider');
  return ctx;
};
