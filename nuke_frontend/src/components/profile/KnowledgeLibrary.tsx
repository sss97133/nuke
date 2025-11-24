import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { KnowledgeLibraryService, KnowledgeArticle } from '../../services/knowledgeLibraryService';
import { ImageSetService, ImageSet } from '../../services/imageSetService';
import { useToast } from '../../hooks/useToast';

interface KnowledgeLibraryProps {
  userId: string;
  isOwnProfile: boolean;
}

const KnowledgeLibrary: React.FC<KnowledgeLibraryProps> = ({ userId, isOwnProfile }) => {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [imageSets, setImageSets] = useState<ImageSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const { showToast } = useToast();

  useEffect(() => {
    loadArticles();
  }, [userId]);

  const loadArticles = async () => {
    try {
      setLoading(true);
      const articlesData = isOwnProfile
        ? await KnowledgeLibraryService.getUserArticles(userId, true)
        : await KnowledgeLibraryService.getPublicArticles(userId);
      setArticles(articlesData);

      // Also load personal image sets (albums)
      if (isOwnProfile) {
        const { data: setsData, error: setsError } = await supabase
          .from('image_sets')
          .select(`
            *,
            image_set_members(
              image_id,
              vehicle_images(image_url, is_primary)
            )
          `)
          .eq('user_id', userId)
          .eq('is_personal', true)
          .order('created_at', { ascending: false });

        if (!setsError && setsData) {
          const setsWithImages = setsData.map((set: any) => {
            const members = set.image_set_members || [];
            const coverImage = members.find((m: any) => m.vehicle_images?.is_primary)?.vehicle_images?.image_url 
              || members[0]?.vehicle_images?.image_url;
            return {
              ...set,
              image_count: members.length,
              cover_image: coverImage
            };
          });
          setImageSets(setsWithImages as any);
        }
      }
    } catch (error) {
      console.error('Error loading knowledge articles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (article: Partial<KnowledgeArticle>) => {
    try {
      if (editingArticle?.id) {
        await KnowledgeLibraryService.updateArticle(editingArticle.id, article as any);
        showToast('Article updated', 'success');
      } else {
        await KnowledgeLibraryService.createArticle({
          user_id: userId,
          title: article.title || '',
          content: article.content || '',
          category: article.category || 'general',
          tags: article.tags || [],
          is_public: article.is_public || false
        } as any);
        showToast('Article created', 'success');
      }
      setEditingArticle(null);
      setShowAddForm(false);
      loadArticles();
    } catch (error: any) {
      console.error('Error saving article:', error);
      showToast(error?.message || 'Failed to save article', 'error');
    }
  };

  const handleDelete = async (articleId: string) => {
    if (!confirm('Are you sure you want to delete this article?')) return;

    try {
      await KnowledgeLibraryService.deleteArticle(articleId);
      showToast('Article deleted', 'success');
      loadArticles();
    } catch (error: any) {
      console.error('Error deleting article:', error);
      showToast(error?.message || 'Failed to delete article', 'error');
    }
  };

  const filteredArticles = articles.filter(article => {
    const matchesSearch = !searchTerm || 
      article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      article.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || article.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...Array.from(new Set(articles.map(a => a.category)))];

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="text text-muted">Loading knowledge library...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="heading-3">Knowledge Library ({articles.length + imageSets.length})</h3>
          {isOwnProfile && (
            <button
              onClick={() => {
                setEditingArticle(null);
                setShowAddForm(true);
              }}
              className="button button-primary"
              style={{ fontSize: '8pt', padding: '6px 12px' }}
            >
              + Add Article
            </button>
          )}
        </div>
        <div className="card-body">
          {/* Search and Filter */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <input
              type="text"
              placeholder="Search articles..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
            />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="form-select"
              style={{ fontSize: '9pt', padding: '6px 8px' }}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat === 'all' ? 'All Categories' : cat}</option>
              ))}
            </select>
          </div>

          {/* Add/Edit Form */}
          {(showAddForm || editingArticle) && isOwnProfile && (
            <div style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              marginBottom: 'var(--space-3)',
              background: 'var(--grey-50)'
            }}>
              <ArticleForm
                article={editingArticle}
                onSave={handleSave}
                onCancel={() => {
                  setEditingArticle(null);
                  setShowAddForm(false);
                }}
              />
            </div>
          )}

          {/* Image Sets Section */}
          {imageSets.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <h4 className="text font-bold" style={{ marginBottom: 'var(--space-2)' }}>Image Sets ({imageSets.length})</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-2)' }}>
                {imageSets.map((set: any) => (
                  <div
                    key={set.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      // Navigate to image set or open in lightbox
                      if (set.vehicle_id) {
                        window.location.href = `/vehicle/${set.vehicle_id}`;
                      }
                    }}
                  >
                    {set.cover_image ? (
                      <img
                        src={set.cover_image}
                        alt={set.name}
                        style={{
                          width: '100%',
                          height: '120px',
                          objectFit: 'cover'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '120px',
                        background: 'var(--grey-200)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8pt',
                        color: 'var(--text-muted)'
                      }}>
                        No Image
                      </div>
                    )}
                    <div style={{ padding: 'var(--space-2)', background: 'var(--white)' }}>
                      <div className="text text-small font-bold" style={{ marginBottom: '2px' }}>
                        {set.name}
                      </div>
                      <div className="text text-small text-muted">
                        {set.image_count || 0} images
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Articles List */}
          {filteredArticles.length === 0 && imageSets.length === 0 ? (
            <div className="text text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              {isOwnProfile ? 'No articles or image sets yet. Create your first article!' : 'No public articles to display.'}
            </div>
          ) : filteredArticles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {filteredArticles.map(article => (
                <div
                  key={article.id}
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    background: 'var(--white)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-2)' }}>
                    <div style={{ flex: 1 }}>
                      <h4 className="text font-bold" style={{ marginBottom: '4px' }}>
                        {article.title}
                        {article.is_public && (
                          <span style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            background: 'var(--success-dim)',
                            color: 'var(--success)',
                            fontSize: '7pt',
                            borderRadius: '2px'
                          }}>
                            PUBLIC
                          </span>
                        )}
                      </h4>
                      <div className="text text-small text-muted">
                        {article.category} • {new Date(article.created_at).toLocaleDateString()}
                      </div>
                      {article.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                          {article.tags.map(tag => (
                            <span
                              key={tag}
                              style={{
                                padding: '2px 6px',
                                background: 'var(--grey-200)',
                                fontSize: '7pt',
                                borderRadius: '2px'
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isOwnProfile && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => {
                            setEditingArticle(article);
                            setShowAddForm(false);
                          }}
                          className="button button-secondary"
                          style={{ fontSize: '8pt', padding: '4px 8px' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(article.id)}
                          className="button button-secondary"
                          style={{ fontSize: '8pt', padding: '4px 8px' }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="text text-small" style={{ 
                    maxHeight: '100px', 
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {article.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface ArticleFormProps {
  article: KnowledgeArticle | null;
  onSave: (article: Partial<KnowledgeArticle>) => void;
  onCancel: () => void;
}

const ArticleForm: React.FC<ArticleFormProps> = ({ article, onSave, onCancel }) => {
  const [title, setTitle] = useState(article?.title || '');
  const [content, setContent] = useState(article?.content || '');
  const [category, setCategory] = useState(article?.category || 'general');
  const [tags, setTags] = useState(article?.tags?.join(', ') || '');
  const [isPublic, setIsPublic] = useState(article?.is_public || false);

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) {
      alert('Title and content are required');
      return;
    }

    onSave({
      title: title.trim(),
      content: content.trim(),
      category: category.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      is_public: isPublic
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <input
        type="text"
        placeholder="Article title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="form-input"
        style={{ fontSize: '10pt', padding: '8px' }}
      />
      <textarea
        placeholder="Article content..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="form-input"
        style={{ 
          fontSize: '9pt', 
          padding: '8px',
          minHeight: '150px',
          fontFamily: 'inherit'
        }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          type="text"
          placeholder="Category (e.g., technical, guide, reference)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="form-input"
          style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
        />
        <input
          type="text"
          placeholder="Tags (comma-separated)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="form-input"
          style={{ flex: 1, fontSize: '9pt', padding: '6px 8px' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          id="is-public"
        />
        <label htmlFor="is-public" className="text text-small">
          Make public (show on profile)
        </label>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          onClick={handleSubmit}
          className="button button-primary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          {article ? 'Update' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          className="button button-secondary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default KnowledgeLibrary;

