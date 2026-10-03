"""Network-free shape contracts; set YONO_MODEL_DIR to exercise installed ONNX files."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

import numpy as np
from PIL import Image
from yono import YONOClassifier, HierarchicalYONO, _preprocess, _session_image_size


class FakeSession:
    def __init__(self, height, width, logits):
        self.shape = ['batch', 3, height, width]
        self.logits = np.array([logits], dtype=np.float32)
        self.calls = 0

    def get_inputs(self):
        return [SimpleNamespace(name='image', shape=self.shape)]

    def run(self, _, inputs):
        assert inputs['image'].shape == (1, 3, self.shape[2], self.shape[3])
        self.calls += 1
        return [self.logits]


class InputContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.image = str(Path(self.temp.name) / 'synthetic.png')
        Image.new('RGB', (321, 199), (20, 40, 60)).save(self.image)

    def test_rectangular_session_controls_width_and_height_without_swapping(self):
        session = FakeSession(224, 260, [1, 0])
        size = _session_image_size(session)
        self.assertEqual(size, (260, 224))
        self.assertEqual(_preprocess(self.image, size).shape, (1, 3, 224, 260))

    def test_existing_explicit_and_default_preprocessing_sizes_are_preserved(self):
        self.assertEqual(_preprocess(self.image).shape, (1, 3, 260, 260))
        self.assertEqual(_preprocess(self.image, 224).shape, (1, 3, 224, 224))

    def test_dynamic_or_non_rgb_inputs_fail_instead_of_guessing(self):
        for shape in [['batch', 3, 'height', 'width'], ['batch', 1, 224, 224], [1, 224, 224, 3], [1, 3, 0, 224]]:
            session = FakeSession(224, 224, [1, 0])
            session.shape = shape
            with self.assertRaises(ValueError):
                _session_image_size(session)

    def test_hierarchy_respects_different_input_shapes_at_each_tier(self):
        classifier = HierarchicalYONO.__new__(HierarchicalYONO)
        classifier._tier1 = FakeSession(224, 224, [1])
        classifier._tier1_input = 'image'
        classifier._family_labels = ['test_family']
        classifier._tier2 = {'test_family': FakeSession(260, 280, [0, 1])}
        classifier._tier2_labels = {'test_family': ['First', 'Second']}
        classifier._flat = None
        result = classifier.predict(self.image)
        self.assertEqual(result['make'], 'Second')
        self.assertEqual(classifier._tier1.calls, 1)
        self.assertEqual(classifier._tier2['test_family'].calls, 1)

    @unittest.skipUnless(os.environ.get('YONO_MODEL_DIR'), 'installed models are optional')
    def test_installed_model_rejects_old260_and_accepts_its_actual_input_contract(self):
        model_dir = Path(os.environ['YONO_MODEL_DIR'])
        classifier = YONOClassifier(str(model_dir / 'yono_make_v1.onnx'), str(model_dir / 'yono_labels.json'))
        self.assertEqual(classifier.session.get_outputs()[0].shape[-1], len(classifier.labels))
        self.assertEqual(classifier._image_size, (224, 224))
        with self.assertRaises(Exception) as error:
            classifier.session.run(None, {classifier._input_name: _preprocess(self.image)})
        self.assertIn('Got: 260 Expected: 224', str(error.exception))
        result = classifier.predict(self.image)
        self.assertTrue(np.isfinite(result['confidence']))
        self.assertIn(result['make'], classifier.labels)
        self.assertEqual(len(result['top5']), 5)


if __name__ == '__main__':
    unittest.main()
