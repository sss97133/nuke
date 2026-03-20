/**
 * usePhotoLibrary — React Query infinite query for the photo inbox.
 *
 * Wraps PersonalPhotoLibraryService.getPhotosCursorPaginated with
 * useInfiniteQuery for cursor-based pagination.
 *
 * Server sorts: taken_at ASC NULLS LAST, created_at ASC, id ASC
 * Pages arrive in display order — EXIF-dated photos first, then bulk-import.
 * No client-side re-sort needed.
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

interface PhotoCursor {
  taken_at: string | null;
  created_at: string;
  id: string;
}

interface PhotoPage {
  photos: PersonalPhoto[];
  totalCount: number;
  nextCursor?: PhotoCursor;
}

const PAGE_SIZE = 200;

export function usePhotoLibrary(filters: PhotoLibraryFilters = {}) {
  const queryKey = ['photo-library', filters.hideOrganized, filters.filterStatus, filters.filterAngle];

  const query = useInfiniteQuery<PhotoPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as PhotoCursor | undefined;

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

      // Compute next cursor from last photo — includes taken_at for keyset pagination
      const lastPhoto = result.photos[result.photos.length - 1];
      const nextCursor: PhotoCursor | undefined =
        result.photos.length >= PAGE_SIZE && lastPhoto
          ? { taken_at: lastPhoto.taken_at || null, created_at: lastPhoto.created_at, id: lastPhoto.id }
          : undefined;

      return {
        photos: result.photos,
        totalCount: result.totalCount,
        nextCursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as PhotoCursor | undefined,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Flatten pages in order — server already sorts taken_at ASC NULLS LAST,
  // created_at ASC, id ASC so pages arrive in display order.
  const photos = useMemo(() => {
    return query.data?.pages.flatMap((p) => p.photos) ?? [];
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
