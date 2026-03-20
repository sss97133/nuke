/**
 * usePhotoLibrary — React Query infinite query for the photo inbox.
 *
 * Wraps PersonalPhotoLibraryService.getPhotosCursorPaginated with
 * useInfiniteQuery for cursor-based pagination.
 *
 * Usage:
 *   const { photos, totalCount, hasNextPage, fetchNextPage, isFetching } = usePhotoLibrary(filters);
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { PersonalPhotoLibraryService } from '../services/personalPhotoLibraryService';
import type { PersonalPhoto } from '../services/personalPhotoLibraryService';
import { useMemo } from 'react';

export interface PhotoLibraryFilters {
  hideOrganized?: boolean;
  filterStatus?: string | null;
  filterAngle?: string | null;
}

interface PhotoPage {
  photos: PersonalPhoto[];
  totalCount: number;
  nextCursor?: { created_at: string; id: string };
}

const PAGE_SIZE = 200;

export function usePhotoLibrary(filters: PhotoLibraryFilters = {}) {
  const queryKey = ['photo-library', filters.hideOrganized, filters.filterStatus, filters.filterAngle];

  const query = useInfiniteQuery<PhotoPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as { created_at: string; id: string } | undefined;

      // Map filter status
      let filterStatus: string | undefined;
      if (filters.filterStatus) {
        filterStatus = filters.filterStatus;
      }

      const result = await PersonalPhotoLibraryService.getPhotosCursorPaginated({
        cursor,
        limit: PAGE_SIZE,
        filterStatus,
        hideOrganized: filters.hideOrganized !== false,
      });

      // Compute next cursor from last photo
      const lastPhoto = result.photos[result.photos.length - 1];
      const nextCursor = result.photos.length >= PAGE_SIZE && lastPhoto
        ? { created_at: lastPhoto.created_at, id: lastPhoto.id }
        : undefined;

      return {
        photos: result.photos,
        totalCount: result.totalCount,
        nextCursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as { created_at: string; id: string } | undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Flatten all pages and sort by actual photo date (EXIF taken_at when available)
  // DB keeps created_at order for stable keyset pagination; client sort gives chronological display.
  // Photos WITH taken_at (EXIF dates) sort first (oldest→newest ASC), then photos
  // WITHOUT taken_at sort by created_at ASC. This keeps real-dated photos (2017-2026)
  // visibly separated from the bulk-import cluster (all created_at ~March 2026).
  const photos = useMemo(() => {
    const flat = query.data?.pages.flatMap((p) => p.photos) ?? [];
    return flat.sort((a, b) => {
      const aHasExif = !!a.taken_at;
      const bHasExif = !!b.taken_at;
      // EXIF-dated photos first
      if (aHasExif !== bHasExif) return aHasExif ? -1 : 1;
      // Within each group, sort chronologically (oldest first)
      const dateA = a.taken_at || a.created_at;
      const dateB = b.taken_at || b.created_at;
      const cmp = dateA.localeCompare(dateB);
      if (cmp !== 0) return cmp;
      // Stable tiebreak on id for deterministic order
      return a.id.localeCompare(b.id);
    });
  }, [query.data]);

  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  return {
    photos,
    totalCount,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
